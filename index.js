const { token, prefix, region } = require('./config.json');
const INVITE = 'https://discordapp.com/oauth2/authorize?client_id=698010076509765674&scope=bot&permissions=36702208'

const STATION_API = `https://fred.aimapi.io/services/station/rova?region=${region}`;
const ONAIR_API = `https://bruce.radioapi.io/services/onair/rova?region=${region}`;

const hls = require('hls-stream');
const Discord = require('discord.js');
const prism = require('prism-media');
const request = require('request');
const queue = require('./SegmentQueue');
const client = new Discord.Client();

let broadcasters = new Map();
let stationInformation = new Map();
let onAirServices = [];
let onAirServicesUpdateTime = 0;

client.once('ready', () => {
    fetchStreamInfo().then(stations => {
        client.on('message', message => {
            if (! message.content.startsWith(prefix) || message.author.bot) return;
            let args = message.content.slice(prefix.length).split(' ');
            args.shift();
            
            switch (args[0]) {
                case 'station':
                    let station = stations.find(element => element.id == args[1]);

                    if (!station) {
                        const stationEmbed = new Discord.MessageEmbed()
                            .setColor('#ffffff')
                            .setTitle('Stations')
                            .setAuthor('George FM')
                            .setTimestamp();
                        
                        stations.forEach(station => {
                            stationEmbed.addFields(
                                { name: '\u200B', value: '\u200B' },
                                { name: 'Name', value: station.sortName, inline: true },
                                { name: 'Command', value: `${prefix} station ${station.id}`, inline: true }
                            );
                        });

                        message.channel.send(stationEmbed);
                        break;
                    }

                    if (! broadcasters.get(station.id)) {
                        const broadcaster = client.voice.createBroadcast();

                        const opus = new prism.opus.Encoder({
                            channels: 2,
                            rate: 48000,
                            frameSize: 960
                        });

                        opus.on('error', (err) => console.error(`Opus ${station.id}: Error - ${err}`));
                        opus.on('end', () => console.log(`Opus ${station.id}: ended`));

                        const stream = hls.createReadStream(station.highQualityStreamUrl);
                        const dispatcher = broadcaster.play(opus, { type: 'opus' });

                        dispatcher.on('start', () => console.log(`Dispatcher ${station.id}: starting broadcast...`));
                        dispatcher.on('error', (err) => console.error(`Dispatcher ${station.id}: error - ${err}`));
                        dispatcher.on('end', () => console.log(`Dispatcher ${station.id}: ended`));

                        const ffmpeg = new prism.FFmpeg({
                            args: [
                                '-loglevel', '0',
                                '-analyzeduration', '0',
                                '-f', 's16le',
                                '-ar', '48000',
                                '-ac', '2'
                            ]
                        });

                        const handleBroadcasterClose = () => {
                            stream.destroy();
                            ffmpeg.destroy();
                            opus.destroy();

                            broadcasters.delete(station.id);
                        };

                        broadcaster.on('subscribe', dispatcher => {
                            console.log(`Broadcaster ${station.id}: new subscriber, currently ${broadcaster.subscribers.length} subscribers`);
                        });

                        broadcaster.on('unsubscribe', dispatcher => {
                            console.log(`Broadcaster ${station.id}: subscriber left, currently ${broadcaster.subscribers.length} subscribers`);

                            if (broadcaster.subscribers.length < 1) {
                                console.log(`Broadcaster ${station.id}: closing broadcast, no one subscribed`);
                                handleBroadcasterClose();
                            }
                        });

                        broadcasters.set(station.id, broadcaster);

                        ffmpeg.on('end', () => {
                            console.log(`FFmpeg ${station.id}: ended`);
                            handleBroadcasterClose();
                        })
                        ffmpeg.on('error', (err) => console.error(`FFmpeg ${station.id}: error - ${err}`));
                        ffmpeg.pipe(opus);

                        const segments = new queue.SegmentQueue();

                        stream.on('data', data => {
                            if (data.type == 'playlist' && ! data.isMasterPlaylist && ! segments.isReady()) {
                                let startingSegment = data.segments[0];
                                segments.setStartingSegment(startingSegment.mediaSequenceNumber);
                            }

                            if (data.type != 'segment' || ! segments.isReady()) return;
                            segments.add(data);
                        });

                        segments.on('segment', segment => {
                            ffmpeg.write(segment.data);
                        });

                        segments.on('titles', titles => {
                            console.log(`${station.id}: now playing ${titles[0]}`);

                            stationInformation.set(station.id, {
                                station: station,
                                played: titles
                            });
                        });
                    }

                    if (!message.member.voice.channel) {
                        message.channel.send('You must be in a voice channel.');
                        break;
                    }

                    message.member.voice.channel.join().then(connection => {
                        connection.play(broadcasters.get(station.id));
                    });

                    break;

                case 'leave': 
                    client.voice.connections.forEach(connection => {
                        if (connection.channel == message.member.voice.channel) {
                            connection.disconnect();
                        }
                    });
                    
                    break;

                case 'playing':
                    const generatePlayingEmbed = stationid => {
                        fetchOnAirServices().then(services => {
                            const filteredServices = services.filter(service => service.id == stationid);

                            if (filteredServices.length < 1) {
                                message.channel.send('Could not find a station with the given station id.');
                            } else {
                                const service = filteredServices[0];

                                const nowPlayingEmbed = new Discord.MessageEmbed()
                                    .setColor('#ffffff')
                                    .setTitle(`Last Played - ${service.onAir[0].title}`)
                                    .setThumbnail(service.onAir[0].imageUrl)
                                    .setAuthor('George FM')
                                    .setTimestamp();

                                service.nowPlaying.forEach(song => {
                                    nowPlayingEmbed.addFields(
                                        { name: 'Song', value: song.title, inline: true},
                                        { name: 'Author', value: song.artist, inline: true},
                                        { name: '\u200B', value: '\u200B' }
                                    );
                                });

                                message.channel.send(nowPlayingEmbed);
                            }
                        });
                    };

                    if (! args[1]) {
                        let foundChannel = false;

                        if (message.member.voice.channel) {
                            client.voice.connections.forEach(connection => {
                                if (connection.channel == message.member.voice.channel) {
                                    broadcasters.forEach((broadcast, stationid) => {
                                        if (connection.dispatcher.broadcast == broadcast) {
                                            foundChannel = true;
                                            generatePlayingEmbed(stationid);
                                        }
                                    });
                                }
                            });
                        }

                        if (! message.member.voice.channel || ! foundChannel) {
                            message.channel.send(`Join a voice channel and start the GeorgeFM bot to see what is playing. To see what a station is playing, use \`${prefix} station [stationid]\``);
                        }
                    } else {
                        generatePlayingEmbed(args[1]);
                    }

                    break;

                case 'invite':
                    message.channel.send(INVITE);

                    break;

                default:
                    const helpEmbed = new Discord.MessageEmbed()
                        .setColor('#ffffff')
                        .setTitle('Help')
                        .setAuthor('George FM')
                        .addFields(
                            { name: '!george station [station]', value: 'Shows a list of stations' },
                            { name: '!george leave', value: 'Stops George FM in your voice channel'},
                            { name: '!george playing [station]', value: 'Shows the last 5 songs played' },
                            { name: '!george invite', value: 'Gives the invite link for the bot' }
                        );
                    message.channel.send(helpEmbed);
                    break;
            }
        });
    });
});

client.login(token);

function fetchStreamInfo() {
    return new Promise((resolve, reject) => {
        request(STATION_API, (error, response, body) => {
            if (error) {
                console.error(error);
                reject(error);
                
                return;
            }

            if (! response || response.statusCode != 200) {
                console.error('StreamInfo: no response');
                reject();

                return;
            }

            const data = JSON.parse(body);
            let stations = [];
			data.stations.forEach(station => {
                if (station.brand != 'georgefm' || !station.id) return;

                stations.push(station);
            });

            resolve(stations);
        })
    });
}

function fetchOnAirServices()
{
    return new Promise((resolve, reject) => {
        const currentTime = Date.now();

        if ((currentTime - onAirServicesUpdateTime) < 20000) {
            resolve(onAirServices);
        } else {
            request(ONAIR_API, (error, response, body) => {
                if (error) {
                    console.error(error);
                    reject(error);
                    
                    return;
                }
    
                if (! response || response.statusCode != 200) {
                    console.error('OnAirServices: no response');
                    reject();
    
                    return;
                }
    
                const data = JSON.parse(body).stations;
                
                onAirServices = data;
                onAirServicesUpdateTime = Date.now();
                resolve(data);
            }); 
        }
    });
}
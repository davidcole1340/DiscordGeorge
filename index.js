const { token, prefix, region, bot_id } = require('./config.json');
const INVITE = `https://discordapp.com/oauth2/authorize?client_id=${bot_id}&scope=bot&permissions=36702208`;

const STATION_API = `https://fred.aimapi.io/services/station/rova?region=${region}`;
const ONAIR_API = `https://bruce.radioapi.io/services/onair/rova?region=${region}`;

const Discord = require('discord.js');
const request = require('request');
const client = new Discord.Client();

let broadcasters = new Map();
let stationInformation = new Map();
let onAirServices = [];
let onAirServicesUpdateTime = 0;

client.once('ready', () => {
    fetchStreamInfo().then(stations => {
        console.log(`GeorgeFM bot ready - prefix: ${prefix}`);
        
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
                        const dispatcher = broadcaster.play(station.highQualityStreamUrl);

                        dispatcher.on('start', () => console.log(`Dispatcher ${station.id}: starting broadcast...`));
                        dispatcher.on('error', (err) => console.error(`Dispatcher ${station.id}: error - ${err}`));
                        dispatcher.on('end', () => console.log(`Dispatcher ${station.id}: ended`));

                        const handleBroadcasterClose = () => {
                            // TODO dispatcher end
                            dispatcher.destroy();
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
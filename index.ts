const { token, prefix, region, bot_id } = require('./config.json');
const INVITE = `https://discordapp.com/oauth2/authorize?client_id=${bot_id}&scope=bot&permissions=36702208`;

import * as Discord from 'discord.js';
import Api from './api';
import * as _ from 'lodash';

const client = new Discord.Client();

const broadcasters = new Map();

client.once('ready', () => {
  const api = new Api(region);
  api.fetchStreamInfo().then(stations => {
    console.log(`GeorgeFM bot ready - prefix: ${prefix}`);

    client.on('message', message => {
      if (!message.content.startsWith(prefix) || message.author.bot) return;
      let args = message.content.slice(prefix.length).split(' ');
      args.shift();

      switch (args[0]) {
        case 'station':
          const station = stations.find(element => element.id == args[1]);

          if (! station) {
            // 25 max fields per embed - 3 fields per station, ~8 stations
            const chunks = _.chunk(stations, 8);

            chunks.forEach(chunk => {
              const stationEmbed = new Discord.MessageEmbed()
                .setColor('#ffffff')
                .setTitle('Stations')
                .setAuthor('George FM')
                .setTimestamp();

              chunk.forEach(station => {
                stationEmbed.addFields(
                  { name: '\u200B', value: '\u200B' },
                  { name: 'Name', value: `${station.brandName} - ${station.sortName}`, inline: true },
                  { name: 'Command', value: `${prefix} station ${station.id}`, inline: true }
                );
              });
              
              message.channel.send(stationEmbed);
            });

            break;
          }

          if (! client.voice) {
            message.reply("Error with voice client - please try again.");
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

          if (!message.member?.voice.channel) {
            message.channel.send('You must be in a voice channel.');
            break;
          }

          message.member.voice.channel.join().then(connection => {
            connection.play(broadcasters.get(station.id));
          }, err => {
            message.channel.send('Could not join the voice channel.');
          });

          break;

        case 'leave':
          client.voice?.connections.forEach(connection => {
            if (connection.channel == message.member?.voice.channel) {
              connection.disconnect();
            }
          });

          break;

        case 'playing':
          const generatePlayingEmbed = (stationid: string) => {
            api.fetchOnAirServices().then(services => {
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
                    { name: 'Song', value: song.title, inline: true },
                    { name: 'Author', value: song.artist, inline: true },
                    { name: '\u200B', value: '\u200B' }
                  );
                });

                message.channel.send(nowPlayingEmbed);
              }
            }, console.error);
          };

          if (! args[1]) {
            let foundChannel = false;

            if (message.member?.voice.channel) {
              client.voice?.connections.forEach(connection => {
                if (connection.channel == message.member?.voice.channel) {
                  broadcasters.forEach((broadcast, stationid) => {
                    if (connection.dispatcher.broadcast == broadcast) {
                      foundChannel = true;
                      generatePlayingEmbed(stationid);
                    }
                  });
                }
              });
            }

            if (! message.member?.voice.channel || ! foundChannel) {
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
              { name: `${prefix} station [station]`, value: 'Shows a list of stations' },
              { name: `${prefix} leave`, value: 'Stops George FM in your voice channel' },
              { name: `${prefix} playing [station]`, value: 'Shows the last 5 songs played' },
              { name: `${prefix} invite`, value: 'Gives the invite link for the bot' }
            );
          message.channel.send(helpEmbed);
          break;
      }
    });
  });
});

client.login(token);
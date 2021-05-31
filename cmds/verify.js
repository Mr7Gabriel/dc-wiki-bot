const {randomBytes} = require('crypto');
var db = require('../util/database.js');
var verify = require('../functions/verify.js');
const {oauthVerify, allowDelete, escapeFormatting} = require('../util/functions.js');

/**
 * Processes the "verify" command.
 * @param {import('../util/i18n.js')} lang - The user language.
 * @param {import('discord.js').Message} msg - The Discord message.
 * @param {String[]} args - The command arguments.
 * @param {String} line - The command as plain text.
 * @param {import('../util/wiki.js')} wiki - The wiki for the message.
 */
function cmd_verify(lang, msg, args, line, wiki) {
	if ( !msg.channel.isGuild() || msg.defaultSettings ) return this.LINK(lang, msg, line, wiki);
	if ( !msg.guild.me.permissions.has('MANAGE_ROLES') ) {
		if ( msg.isAdmin() ) {
			console.log( msg.guild.id + ': Missing permissions - MANAGE_ROLES' );
			msg.replyMsg( lang.get('general.missingperm') + ' `MANAGE_ROLES`' );
		}
		else if ( !msg.onlyVerifyCommand ) this.LINK(lang, msg, line, wiki);
		return;
	}
	
	db.query( 'SELECT role, editcount, postcount, usergroup, accountage, rename FROM verification WHERE guild = $1 AND channel LIKE $2 ORDER BY configid ASC', [msg.guild.id, '%|' + msg.channel.id + '|%'] ).then( ({rows}) => {
		if ( !rows.length ) {
			if ( msg.onlyVerifyCommand ) return;
			return msg.replyMsg( lang.get('verify.missing') + ( msg.isAdmin() ? '\n`' + ( patreons[msg.guild.id] || process.env.prefix ) + 'verification`' : '' ) );
		}
		
		if ( ( wiki.isWikimedia() || wiki.isMiraheze() ) && process.env.dashboard ) {
			let oauth = '';
			if ( wiki.isWikimedia() ) oauth = 'wikimedia';
			if ( wiki.isMiraheze() ) oauth = 'miraheze';
			if ( oauth && process.env[`oauth-${oauth}`] && process.env[`oauth-${oauth}-secret`] ) {
				let state = `${oauth}-${global.shardId}` + Date.now().toString(16) + randomBytes(16).toString('hex');
				while ( oauthVerify.has(state) ) {
					state = `${oauth}-${global.shardId}` + Date.now().toString(16) + randomBytes(16).toString('hex');
				}
				oauthVerify.set(state, {
					state, wiki: oauth,
					channel: msg.channel,
					user: msg.author.id
				});
				msg.client.shard.send({id: 'verifyUser', state});
				let oauthURL = `https://meta.${oauth}.org/w/rest.php/oauth2/authorize?response_type=code&redirect_uri=${encodeURIComponent('https://settings.wikibot.de/oauth/mw')}&client_id=${process.env['oauth-' + oauth]}&state=${state}`;
				return msg.member.send( lang.get('verify.oauth_message_dm', escapeFormatting(msg.guild.name)) + '\n<' + oauthURL + '>', {
					components: [
						{
							type: 1,
							components: [
								{
									type: 2,
									style: 5,
									label: lang.get('verify.oauth_button'),
									emoji: {id: null, name: '🔗'},
									url: oauthURL,
									disabled: false
								}
							]
						}
					]
				} ).then( message => {
					msg.reactEmoji('📩');
					allowDelete(message, msg.author.id);
				}, error => {
					if ( error?.code === 50007 ) { // CANNOT_MESSAGE_USER
						return msg.replyMsg( lang.get('verify.oauth_private') );
					}
					log_error(error);
					msg.reactEmoji('error');
				} );
			}
		}
		
		var username = args.join(' ').replace( /_/g, ' ' ).trim().replace( /^<\s*(.*)\s*>$/, '$1' ).replace( /^@/, '' ).split('#')[0].substring(0, 250).trim();
		if ( /^(?:https?:)?\/\/([a-z\d-]{1,50})\.(?:gamepedia\.com\/|(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?(?:wiki\/)?)/.test(username) ) {
			username = decodeURIComponent( username.replace( /^(?:https?:)?\/\/([a-z\d-]{1,50})\.(?:gamepedia\.com\/|(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?(?:wiki\/)?)/, '' ) );
		}
		if ( wiki.isGamepedia() ) username = username.replace( /^userprofile\s*:\s*/i, '' );
		
		if ( !username.trim() ) {
			args[0] = line.split(' ')[0];
			if ( args[0] === 'verification' ) args[0] = ( lang.localNames.verify || 'verify' );
			return this.help(lang, msg, args, line, wiki);
		}
		msg.reactEmoji('⏳').then( reaction => {
			verify(lang, msg.channel, msg.member, username, wiki, rows).then( result => {
				if ( result.oauth ) {
					let state = `${result.oauth}-${global.shardId}` + Date.now().toString(16) + randomBytes(16).toString('hex');
					while ( oauthVerify.has(state) ) {
						state = `${result.oauth}-${global.shardId}` + Date.now().toString(16) + randomBytes(16).toString('hex');
					}
					oauthVerify.set(state, {
						state, wiki: result.oauth,
						channel: msg.channel,
						user: msg.author.id
					});
					msg.client.shard.send({id: 'verifyUser', state});
					let oauthURL = `https://meta.${result.oauth}.org/w/rest.php/oauth2/authorize?response_type=code&redirect_uri=${encodeURIComponent('https://settings.wikibot.de/oauth/mw')}&client_id=${process.env['oauth-' + result.oauth]}&state=${state}`;
					msg.member.send( lang.get('verify.oauth_message_dm', escapeFormatting(msg.guild.name)) + '\n<' + oauthURL + '>', {
						components: [
							{
								type: 1,
								components: [
									{
										type: 2,
										style: 5,
										label: lang.get('verify.oauth_button'),
										emoji: {id: null, name: '🔗'},
										url: oauthURL,
										disabled: false
									}
								]
							}
						]
					} ).then( message => {
						msg.reactEmoji('📩');
						allowDelete(message, msg.author.id);
					}, error => {
						if ( error?.code === 50007 ) { // CANNOT_MESSAGE_USER
							return msg.replyMsg( lang.get('verify.oauth_private') );
						}
						log_error(error);
						msg.reactEmoji('error');
					} );
				}
				else if ( result.reaction ) msg.reactEmoji(result.reaction);
				else {
					var options = {embed: result.embed, components: []};
					if ( result.add_button ) options.components.push({
						type: 1,
						components: [
							{
								type: 2,
								style: 1,
								label: lang.get('verify.button_again'),
								emoji: {id: null, name: '🔂'},
								custom_id: 'verify_again',
								disabled: false
							}
						]
					});
					msg.replyMsg( result.content, options, false, false ).then( message => {
						if ( !result.logging.channel || !msg.guild.channels.cache.has(result.logging.channel) ) return;
						if ( message ) {
							if ( result.logging.embed ) result.logging.embed.addField(message.url, '<#' + msg.channel.id + '>');
							else result.logging.content += '\n<#' + msg.channel.id + '> – <' + message.url + '>';
						}
						msg.guild.channels.cache.get(result.logging.channel).send(result.logging.content, {
							embed: result.logging.embed,
							allowedMentions: {parse: []}
						}).catch(log_error);
					} );
				}
				if ( reaction ) reaction.removeEmoji();
			}, error => {
				console.log( '- Error during the verifications: ' + error );
				msg.replyMsg( lang.get('verify.error_reply'), {}, false, false ).then( message => {
					if ( message ) message.reactEmoji('error');
				} );
			} );
		} );
	}, dberror => {
		console.log( '- Error while getting the verifications: ' + dberror );
		msg.replyMsg( lang.get('verify.error_reply'), {}, false, false ).then( message => {
			if ( message ) message.reactEmoji('error');
		} );
	} );
}

module.exports = {
	name: 'verify',
	everyone: true,
	pause: false,
	owner: false,
	run: cmd_verify
};

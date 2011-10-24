var http  = require('http');
var https = require('https');
var events = require('events');

var libxmljs = require("libxmljs");
var winston = require('winston');

Shift8 = function( options ) {
	var self = this;

	var options = options || {};

	/**
	 * The ip address of the remote asterisk server
	 *
	 * @var string
	 */
	this.server = options.server || null;

	/**
	 * The port on which the remote asterisk server is listening
	 *
	 * @var int
	 */
	this.port = options.port || 8088;

	/**
	 * The location of the AJAM interface on the remote server
	 *
	 * @var string
	 */
	this.ajam = options.ajam || '/mxml';

	/**
	 * The manager to use to connect with
	 *
	 * @var string
	 */
	this.manager = options.manager || null;

	/**
	 * The secret of the manager to connect with
	 *
	 * @var string
	 */
	this.secret = options.secret || null;

	/**
	 * Use https to connect to remote server
	 *
	 * @var boolean
	 */
	this.useHttps = options.useHttps || false;

	/**
	 * The client to the remove AJAM interface
	 *
	 * @var object
	 */
	this.client;

	/**
	 * The session id from the remote asterisk
	 *
	 * @var string
	 */
	this.sessionId;

	/**
	 * The XML Parser
	 *
	 * @var object
	 */
	this.parser;

	self.client = http.createClient(self.port, self.server, self.useHttps);
	events.EventEmitter.call(this);
};

Shift8.super_ = events.EventEmitter;
Shift8.prototype = Object.create(events.EventEmitter.prototype, {
	constructor: {
		value: Shift8,
		enumerable: false
	}
});

module.exports = Shift8;

/**
 * Basic function of the whole library, responsible for dispatching the messages to the
 * remote asterisk
 *
 * @param array parameters The parameters to pass to the remote AJAM
 * @param function callback The callback function to execute on return
 */
Shift8.prototype.send = function( parameters, callback ) {
	var self = this;

	var url = parameters.ajam || self.ajam;

	url += "?";

	for( var key in parameters ) {
		url += key + "=" + encodeURIComponent(parameters[key]) + "&";
	}

	winston.debug("Performing request on: " + url);

	var request = self.client.request("GET", url, {
		'Host':		self.server,
		'Cookie':	(self.sessionId) ? "mansession_id=\"" + self.sessionId + "\"" : ""
	});

	request.on('response', function(response) {
		var buffer = [];

		// Fix the XML a bit
		buffer.push("<?xml version='1.0' encoding='UTF-8'?>");

		response.on('data', function(chunk) {
			buffer.push(chunk);
		});

		response.on('end', function() {
			var cookie = response.headers['set-cookie'];

			if (cookie) {
				cookie = (cookie + "").split(";").shift()

				if( cookie ) {
					self.sessionId = cookie.split("=").pop().replace(/"/g, "");
				}						
			}

			buffer = buffer.join("").replace(/\n/g, "");
			winston.debug(buffer);

			try {
				var xml = libxmljs.parseXmlString(buffer);
			} catch( exception ) {
				self.emit('error', "Unable to process response retrieved from the remote asterisk");

				winston.error("Unable to process response retrieved from the remote asterisk");
				return;
			}

			var results = xml.find("///generic");

			// First in array is always the response to the command sent
			if( results[0].attr('response') && results[0].attr('response').value() == 'Error') {
				callback && callback( (results[0].attr('message')) ? results[0].attr('message').value() : "Unable to process command" );
			}
			else {
				var events = [];

				for( var c in results ) {
					var event = {};

					var attributes = results[c].attrs();

					for ( var i in attributes ) {
						var variable = attributes[i].name();

						event[variable] = attributes[i].value();
					}

					events.push(event);
				}

				callback && callback(null, events);
			}
		});

		response.on('error', function( error ) {
			self.emit('error', "Unable to receive response from remote asterisk: " + error);

			winston.error("Unable to receive response from remote asterisk: " + error);
		});
	});

	request.on('error', function(error) {
		self.emit('error', "Unable to perform the request on the remote asterisk: " + error);

		winston.error("Unable to perform the request on the remote asterisk: " + error);
	});

	request.end();
};

/**
 * Login to the remote asterisk's manager interface. Will emit the 'connected' event on connection
 */
Shift8.prototype.login = function() {
	var self = this;

	self.send({
		'Action':	'login',
		'Username':	self.manager,
		'Secret':	self.secret
	}, function( error, response ) {
		if( error ) {
			self.emit('error', "Unable to connect to remote asterisk (" + error + ")");
		}
		else {
			self.emit('connected');
		}
	});
};

/**
 * Logoffs from the remote asterisk's manager interface. Will emit the 'disconnected' event on completion
 */
Shift8.prototype.logoff = function() {
	this.send({
		'Action':	'logoff'
	}, function( error, response ) {
		if( error ) {
			self.emit('error', "Unable to connect to remote asterisk (" + error + ")");
		}
		else {
			self.emit('disconnected');
		}
	});
};

/**
 * Wait for asterisk to send us events. This will emit 'event' which can be listened
 *
 * @param boolean perm Whether the waitEvent is permanent. (On WaitEventComplete to fire a new event)
 */
Shift8.prototype.waitEvent = function( perm ) {
	var self = this;

	this.send({
		'Action':	'WaitEvent'
	}, function( error, events ) {
		if( error ) {
			self.emit('error', error);
			return;
		}

		for( var c in events ) {
			self.emit('event', events[c]);

			if( events[c].event == 'WaitEventComplete' && perm ) {
				self.waitEvent(perm);
			}
		}
	});
};

/**
 * Adds a new interface in the Queue
 *
 * @param string queue The queue to add the interface to
 * @param string interface The interface to add to the queue
 * @param string member The member name for this interface
 * @param int penalty The penalty for this agent
 * @param boolean paused Whether the agent will be paused on login
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.queueAddInterface = function( queue, interface, member, penalty, paused, callback ) {
	var parameters = {
		'Action':	'QueueAdd',
		'Queue':	queue,
		'Interface':	interface
	};

	if( member )
		parameters.MemberName = member;

	if( penalty )
		parameters.Penalty = penalty;

	if( paused )
		parameters.Paused = 1;

	this.send(parameters, callback);
};

/**
 * Remove an interface from the Queue
 *
 * @param string queue The queue to remove the interface from
 * @param string interface The interface to remove from the queue
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.queueRemoveInterface = function( queue, interface, callback ) {
	this.send({
		'Action':	'QueueRemove',
		'Queue':	queue,
		'Interface':	interface
	}, callback);
};

/**
 * Changes the paused status of an interface.
 *
 * @param string inteface The interface to change the status
 * @param integer paused The paused value. 1 for Paused, 0 for Unpaused
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.changeQueuePaused = function( interface, paused, callback ) {
	this.send({
		'Action':	'QueuePause',
		'Interface':	interface,
		'Paused':	paused
	}, callback);
};

/**
 * Performs an agent pause on the interface
 *
 * @param string interface The interface to pause
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.pauseQueueInterface = function( interface, callback ) {
	this.changeQueuePaused( interface, 1, callback );
};

/**
 * Performs an agent un-pause on the interface
 *
 * @param string interface The interface to unpause
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.unpauseQueueInterface = function( interface, callback ) {
	this.changeQueuePaused( interface, 0, callback );
};

/**
 * Retrieves the status from the Queues mechanism. It can retrieve either the status for all the Queues
 * or the status for a specific queue/queue member
 *
 * @param string queue The queue to retrieve status for. (Optional)
 * @param string member The member to retrieve status for. (Optional)
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getQueueStatus = function( queue, member, callback ) {
	var parameters = {
		'Action': 'QueueStatus'
	};

	if( queue )
		parameters.Queue = queue;

	if( member )
		parameters.Member = member;

	this.send( parameters, callback );
};

/**
 * Retrieves the Queue summary for a specific queue if one has been defined, or for the entire system
 *
 * @param string queue The queue to get the summary for. If not specified the summary for all the queues is returned
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getQueueSummary = function( queue, callback ) {
	var parameters = {
		'Action': 'QueueSummary'
	};

	if( queue )
		parameters.Queue = queue;

	this.send(parameters, callback);
};

/**
 * Lists agents and their status
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getAgents = function( callback ) {
	this.send({
		'Action': 'Agents'
	}, callback);
};

/**
 * Get a queue rule
 *
 * @param string rule The queue rule to get
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getQueueRule = function( rule, callback ) {
	this.send({
		'Action': 'QueueRule',
		'Rule'	: rule
	}, callback);
};

/**
 * Sets the Queue Penalty for a member
 *
 * @param string member The queue member to set the penalty
 * @param string queue The queue this member
 * @param integer penalty The penalty to set
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.setQueueMemberPenalty = function( member, queue, penalty, callback ) {
	this.send({
		'Action':		'QueuePenalty',
		'Interface':		member,
		'Queue'	:		queue,
		'Penalty':		penalty
	}, callback);
};

/**
 * Get the queues from the remote asterisk server
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getQueues = function( callback ) {
	this.send({
		'Action': 'Queues'
	}, callback);
};

/**
 * Allows you to write your own events into the queue log
 *
 * @param string queue The queue to write the event for
 * @param integer unique_id The unique id for the queue log
 * @param string interface The interface for the log
 * @param string event The actual event that needs to be recorded
 * @param string message The message to log in the queue log
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.addQueueLog = function( queue, unique_id, interface, event, message, callback ) {
	this.send({
		'Action':		'QueueLog',
		'Queue'	:		queue,
		'UniqueID':		unique_id,
		'Interface':		interface,
		'Event'	:		event,
		'Message':		message
	}, callback);
};


/**
 * Get a SIP Peer from the remote asterisk as specified by peer
 *
 * @param string peer The peer to get information for
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getSipPeer = function( peer, callback ) {
	this.send({
		'Action': 'sipshowpeer',
		'Peer'	: peer
	}, callback);
};

/**
 * Retrieve the SIP Peers from the remote asterisk server
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getSipPeers = function( callback ) {
	this.send({
		'Action': 'SipPeers'
	}, callback);
};

/**
 * Plays a dtmf digit on the specified channel
 *
 * @param string dtmf The dtmf digit to play
 * @param string channel Channel name to send digit to
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.playDTMF = function( dtmf, channel, callback ) {
	this.send({
		'Action':	'PlayDTMF',
		'Channel':	channel,
		'Digit'	:	dtmf
	}, callback);
};

/**
 * Sends a SIP Notify message to a peer
 *
 * @param string channel The channel to sent the notify
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.sentSIPNotify = function( channel, callback ) {
	this.send({
		'Action':	'SIPnotify',
		'Channel':	channel
	}, callback);
};

/**
 * Retrieves the SIP Registry from the remote Asterisk server
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getSipRegistry = function( callback ) {
	this.send({
		'Action': 'SIPshowregistry'
	}, callback);
};

/**
 * List All Voicemail User Information
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getVoicemailUsers = function( callback ) {
	this.send({
		'Action': 'VoicemailUsersList'
	}, callback);
};

/**
 * Retrieves the IAX Peers from the remote asterisk server
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getIAXPeers = function( callback ) {
	this.send({
		'Action': 'IAXpeers'
	}, callback);
};

/**
 * Retrieves the IAX Peers from the remote asterisk server
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getIAXPeerList = function( callback ) {
	this.send({
		'Action': 'IAXpeerlist'
	}, callback);
};

/**
 * Retrieve the IAX Net stats
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getIAXNetStats = function( callback ) {
	this.send({
		'Action': 'IAXnetstats'
	}, callback);
};

/**
 * Unpauses monitoring of a channel on which monitoring had previously been paused with PauseMonitor.
 *
 * @param string channel The channel to unpause monitor
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.unpauseMonitor = function( channel, callback ) {
	this.send({
		'Action':	'UnpauseMonitor',
		'Channel':	channel
	}, callback);
};

/**
 * The 'PauseMonitor' action may be used to temporarily stop the recording of a channel
 *
 * @param string channel The channel to pause monitor
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.pauseMonitor = function( channel, callback ) {
	this.send({
		'Action':	'PauseMonitor',
		'Channel':	channel
	}, callback);
};

/**
 * Change monitoring filename of a channel. Has no effect if the channel is not monitored
 *
 * @param string channel Used to specify the channel to record
 * @param string file Is the new name of the file created in the monitor spool directory
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.changeMonitor = function( channel, file, callback ) {
	this.send({
		'Action':	'ChangeMonitor',
		'Channel':	channel,
		'File'	:	file
	}, callback);
};

/**
 * Stops monitoring a channel. Has no effect if the channel is not monitored
 *
 * @param string channel The channel to stop monitoring
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.stopMonitor = function( channel, callback ) {
	this.send({
		'Action':	'StopMonitor',
		'Channel':	channel
	}, callback);
};

/**
 * The 'Monitor' action may be used to record the audio on a specified channel.
 *
 * @param string channel Used to specify the channel to record
 * @param string file  Is the name of the file created in the monitor spool directory.  Defaults to the same name as the channel (with slashes replaced with dashes)
 * @param string format Is the audio recording format.  Defaults to wav
 * @param boolean mix Boolean parameter as to whether to mix the input and output channels together after the recording is finished
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.monitor = function( channel, file, format, mix, callback ) {
	var parameters = {
		'Action':	'Monitor',
		'Channel':	channel
	};

	if( file )
		parameters.File = file;

	if( format )
		parameters.Format = format;

	if( mix )
		parameters.Mix = 1;

	this.send(parameters, callback);
};

/**
 * Send a message to a Jabber Channel
 *
 * @param string jabber Client or transport Asterisk uses to connect to JABBER
 * @param string screenName User Name to message.
 * @param string message Message to be sent to the buddy
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.sendMessageToJabberChannel = function( jabber, screenName, message, callback ) {
	this.send({
		'Action':	'JabberSend',
		'Jabber':	jabber,
		'ScreenName':	screenName,
		'Message':	message
	}, callback);
};

/**
 * Add a new command to execute by the Async AGI application
 *
 * @param string channel The channel to execute the command at
 * @param string command The command to execute
 * @param string command_id The command id
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.AGI = function( channel, command, command_id, callback ) {
	this.send({
		'Action':	'AGI',
		'Channel':	channel,
		'Command':	command,
		'CommandID':	command_id
	}, callback);
};

/**
 * Removes database keytree/values
 *
 * @param string family
 * @param string key (Optional)
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.DBDelTree = function( family, key, callback ) {
	var parameters = {
		'Action':		'DBDelTree',
		'Family':		family
	};

	if( key )
		parameters.Key = key;

	this.send( parameters, callback );
};

/**
 * Removes database key/value
 *
 * @param string family
 * @param string key
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.DBDel = function( family, key, callback ) {
	this.send({
		'Action':	'DBDel',
		'Family':	family,
		'Key'	:	key
	}, callback);

	this.send( parameters, callback );
};

/**
 * Gets a database value
 *
 * @param string family
 * @param string key
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.DBGet = function( family, key, callback ) {
	this.send({
		'Action':	'DBGet',
		'Family':	family,
		'Key'	:	key
	}, callback);
};

/**
 * Adds / updates a database value
 *
 * @param string family
 * @param string key
 * @param string value (Optional)
 */
Shift8.prototype.DBPut = function( family, key, value, callback ) {
	this.send({
		'Action':	'DBPut',
		'Family':	family,
		'Key'	:	key,
		'Val'	:	(value) ? value : ''
	}, callback);
};

/**
 * Bridge channels together
 *
 * @param string channelA The first channel to bridge
 * @param string channelB The second channel to bridge
 * @param string tone Play a tone to the bridged channels. (Optional)
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.bridge = function( channelA, channelB, callback ) {
	var parameters = {
		'Action':		'Bridge',
		'Channel1':		channelA,
		'Channel2':		channelB
	};

	if( tone )
		parameters.Tone = tone;

	this.send(parameters, callback);
};

/**
 * Park a channel
 *
 * @param string channelA
 * @param string channelB
 * @param integer timeout
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.park = function( channelA, channelB, timeout, callback ) {
	var parameters = {
		'Action':		'Bridge',
		'Channel':		channelA,
		'Channel2':		channelB
	};

	if( timeout )
		parameters.Timeout = timeout;

	this.send( parameters, callback );
};

/**
 * List parked calls
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getParkedCalls = function( callback ) {
	this.send({
		'Action': 'ParkedCalls'
	}, callback);
};

/**
 * Show dialplan extensions
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getDialplan = function( callback ) {
	this.send({
		'Action': 'ShowDialPlan'
	}, callback);
};

/**
 * Checks if Asterisk module is loaded
 *
 * @param string module Asterisk module name (not including extension)
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.isModuleLoaded = function( module, callback ) {
	this.send({
		'Action': 'ModuleCheck',
		'Module': module
	}, callback);
};

/**
 * Loads, unloads or reloads an Asterisk module in a running system.
 * If no module is specified for a reload loadtype, all modules are reloaded
 *
 * @param string module Asterisk module name (not including extension) or subsystem identifier: cdr, enum, dnsmgr, extconfig, manager, rtp, http (Optional)
 * @param string loadType load | unload | reload The operation to be done on module
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.loadModule = function( module, loadType, callback ) {
	var parameters = {
		'Action':		'ModuleLoad',
		'LoadType':		loadType
	};

	if( loadType != 'reload' && !module )
		return false;

	if( module )
		parameters.Module = module;

	this.send( parameters, callback );
};

/**
 * List currently defined channels and some information about them.
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getActiveChannels = function( callback ) {
	this.send({
		'Action': 'CoreShowChannels'
	}, callback);
};

/**
 * Send a reload event. Works the same as sending a ModuleLoad event (reload) without specifying
 * any modules
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.reload = function( callback ) {
	this.send({
		'Action': 'Reload'
	}, callback);
};

/**
 * Show PBX core status information
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getCoreStatusVariables = function( callback ) {
	this.send({
		'Action': 'CoreStatus'
	}, callback);
};

/**
 * Show PBX core settings information
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getCoreSettings = function( callback ) {
	this.send({
		'Action': 'CoreSettings'
	}, callback);
}

/**
 * Send an event to manager sessions
 *
 * @param string userEvent Event string to send
 * @param function callback The callback function if any to execute when the command has finished
 *
 * @todo This might need something more. Header1-N handling
 */
Shift8.prototype.sendUserEvent = function( userEvent, callback ) {
	this.send({
		'Action':	'UserEvent',
		'UserEvent':	userEvent
	}, callback);
};

/**
 * Sends A Text Message while in a call
 *
 * @param string channel Channel to send message to
 * @param string message Message to send
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.sendText = function( channel, message, callback ) {
	this.send({
		'Action':	'SendText',
		'Channel':	channel,
		'Message':	message
	}, callback);
};

/**
 * Returns the action name and synopsis for every action that is available to the use
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.listCommands = function( callback ) {
	this.send({
		'Action': 'ListCommands'
	}, callback);
};

/**
 * Checks a voicemail account for new messages.
 *
 * @param string mailbox Full mailbox ID <mailbox>@<vm-context>
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getMailboxCount = function( mailbox, callback ) {
	this.send({
		'Action':	'MailboxCount',
		'Mailbox':	mailbox
	}, callback);
};

/**
 * Checks a voicemail account for status
 *
 * @param string mailbox Full mailbox ID <mailbox>@<vm-context>
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getMailboxStatus = function( mailbox, callback ) {
	this.send({
		'Action':	'MailboxStatus',
		'Mailbox':	mailbox
	}, callback);
};

/**
 * Hangup a channel after a certain time.
 *
 * @param string channel Channel name to hangup
 * @param integer timeout Maximum duration of the call (sec)
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.setAbsoluteTimeout = function( channel, timeout, callback ) {
	this.send({
		'Action': 'AbsoluteTimeout'
	}, callback);

};

/**
 * Report the extension state for given extension. If the extension has a hint, will use devicestate to check
 * the status of the device connected to the extension.
 *
 * @param string exten Extension to check state on
 * @param string context Context for extension
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getExtensionState = function( exten, context, callback ) {
	this.send({
		'Action':	'ExtensionState',
		'Exten'	:	exten,
		'Context':	context
	}, callback);
};

/**
 * Run a CLI command
 *
 * @param string command Asterisk CLI command to run
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.executeCommand = function( command, callback ) {
	this.send({
		'Action':	'Command',
		'Command':	command
	}, callback);
}

/**
 * Generates an outgoing call to a Extension/Context/Priority or Application/Data
 *
 * @param string channel Channel name to call
 * @param string context Context to use (requires 'Exten' and 'Priority')
 * @param string exten Extension to use (requires 'Context' and 'Priority')
 * @param string priority Priority to use (requires 'Exten' and 'Context')
 * @param string application Application to use
 * @param string data Data to use (requires 'Application')
 * @param string timeout How long to wait for call to be answered (in ms. Default: 30000)
 * @param string callerID Caller ID to be set on the outgoing channel
 * @param string variable Channel variable to set, multiple Variable: headers are allowed
 * @param string account Account code
 * @param string async Set to 'true' for fast origination
 * @param string codecs The codecs to use
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.originate = function( channel, context, exten, priority, application, data, timeout, callerID, variable, account, async, codecs, callback ) { 
	if( exten && (!context || !priority) )
		return false;

	if( context && (!exten || !priority) )
		return false;

	if( priority && (!exten || !context) )
		return false;

	if( data && !application )
		return false;

	var parameters = {
		'Action':		'Originate',
		'Channel':		channel
	};

	if( exten )
		parameters.Exten = exten;

	if( context )
		parameters.Context = context;

	if( priority )
		parameters.Priority = priority;

	if( application )
		parameters.Application = application;

	if( data )
		parameters.Data = data;

	if( timeout )
		parameters.Timeout = timeout;

	if( callerID )
		parameters.CallerID = callerID;

	if( variable )
		parameters.Variable = variable;

	if( account )
		parameters.Account = account;

	if( async )
		parameters.Async = 'true';
	else
		parameters.Async = 'false';

	if( codecs )
		parameters.Codecs = codecs;

	this.send(parameters, callback);
};

/**
 * Attended transfer
 *
 * @param string channel
 * @param string exten
 * @param string context
 * @param integer priority
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.attendedTransfer = function( channel, exten, context, priority, callback ) {
	this.send({
		'Action':	'Atxfer',
		'Channel':	channel,
		'Exten'	:	exten,
		'Context':	context,
		'Priority':	priority
	}, callback);
};

/**
 * Synonymous for redirect().
 *
 * @see redirect
 */
Shift8.prototype.transfer = function( channel, extraChannel, exten, context, priority, callback ) {
	self.redirect(channel, extraChannel, exten, context, priority, callback);
};

/**
 * Redirect (transfer) a call
 *
 * @param string channel Channel to redirect
 * @param string extraChannel Second call leg to transfer (optional)
 * @param string exten Extension to transfer to
 * @param string context Context to transfer to
 * @param integer priority Priority to transfer to
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.redirect = function( channel, extraChannel, exten, context, priority, callback ) {
	var parameters = {
		'Action':	'Redirect',
		'Channel':	channel,
		'Exten'	:	exten,
		'Context':	context,
		'Priority':	priority
	};

	if( extraChannel )
		parameters.ExtraChannel = extraChannel;

	this.send(parameters, callback);
};

/**
 * A 'ListCategories' action will dump the categories in a given file.
 *
 * @param string filename The filename to dump the categories from
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.listCategories = function( filename, callback ) {
	this.send({
		'Action':	'ListCategories',
		'Filename':	filename
	}, callback);
};

/**
 * A 'CreateConfig' action will create an empty file in the configuration directory.
 * This action is intended to be used before an UpdateConfig action.
 *
 * @param string filename The filename to create
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.createConfigurationFile = function( filename, callback ) {
	this.send({
		'Action':	'CreateConfig',
		'Filename':	filename
	}, callback);
};

/**
 * Lists channel status along with requested channel vars
 *
 * @param string channel Name of the channel to query for status
 * @param string variables Comma ',' separated list of variables to include
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getStatus = function( channel, variables, callback ) {
	var parameters = {
		'Action':		'Status'
	};

	if( channel )
		parameters.Channel = channel;
		
	if( variables )
		parameters.Variables = variables;
	
	this.send(parameters, callback);
};

/**
 * A 'GetConfigJSON' action will dump the contents of a configuration file by category and contents in JSON format.
 * This only makes sense to be used using rawman over the HTTP interface.
 *
 * @param string filename Configuration filename (e.g. foo.conf)
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getConfigJson = function( filename, callback ) {
	this.send({
		'Action':	'GetConfigJSON',
		'Filename':	filename
	}, callback);
};

/**
 * A 'GetConfig' action will dump the contents of a configuration file by category and contents or optionally by specified category only
 *
 * @param string filename Configuration filename (e.g. foo.conf)
 * @param string category Category in configuration file
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getConfig = function( filename, category, callback ) {
	var parameters = {
		'Action':	'GetConfig',
		'Filename':	filename
	};
	
	if( category )
		parameters.Category = category;
	
	this.send(parameters, callback);
};

/**
 * Get the value of a global or local channel variable
 *
 * @param string variable Variable name
 * @param string channel Channel to read variable from
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.getChannelVariable = function( variable, channel, callback ) {
	var parameters = {
		'Action':		'GetVar',
		'Variable':		variable
	};
	
	if( channel )
		parameters.Channel = channel;
		
	this.send(parameters, callback);
};

/**
 * Get the value of a global or local channel variable
 *
 * @param string variable Variable name
 * @param string value Value
 * @param string channel Channel to read variable from
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.setChannelVariable = function( variable, value, channel, callback ) {
	var parameters = {
		'Action':		'Setvar',
		'Variable':		variable,
		'Value'	:		value
	};

	if( channel ) 
		parameters.Channel = channel;

	this.send(parameters, callback);
};

/**
 * Hangup a channel 
 *
 * @param string channel The channel name to be hungup
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.hangup = function( channel, callback ) {
	this.send({
		'Action':	'Hangup',
		'Channel':	channel
	}, callback);
};

/**
 * Generate Challenge for MD5 Auth
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.challenge = function( callback ) {
	this.send({
		'Action':	'Challenge',
		'AuthType':	'MD5'
	}, callback);
};

/**
 * Enable/Disable sending of events to this manager client.
 *
 * @param string eventMask The event mask to apply to this manager client
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.events = function( eventMask, callback ) {
	this.send({
		'Action':	'Events',
		'EventMask':	eventMask
	}, callback);
};

/**
 * Pings the remote asterisk server. Keeps the remote connection alive
 *
 * @param function callback The callback function if any to execute when the command has finished
 */
Shift8.prototype.ping = function( callback ) {
	this.send({
		'Action': 'ping'
	}, callback);
};

/**
 * Retrieves the asterisk session Id.
 *
 * @return string
 */
Shift8.prototype.getSessionId = function() {
	return self.sessionId;
};

/**
 * Sets the cookie to be used for the connection with the remote asterisk server. 
 *
 * @param string cookie The cookie from an already established connection to a remote asterisk server
 */
Shift8.prototype.setSessionId = function( sessionId ) {
	self.sessionId = sessionId;
};

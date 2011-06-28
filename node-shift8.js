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
				callback(null, results);
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
	}, function( error, results ) {
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
	var self = this;

	self.send({
		'Action':	'logoff'
	}, function( error, results ) {
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

	self.send({
		'Action':	'WaitEvent'
	}, function( error, results ) {
		if( error ) {
			self.emit('error', error);
			return;
		}

		for( var c in results ) {
			var result = results[c];

			if( result.attr('event') ) {
				// Event
				var event = {};
				var attributes = result.attrs();

				for ( var i in attributes ) {
					var variable = attributes[i].name();

					event[variable] = attributes[i].value();
				}

				self.emit('event', event);

				if( event.event == 'WaitEventComplete' && perm ) {
					self.waitEvent(perm);
				}
			}
		}
	});
};

module.exports = Shift8;

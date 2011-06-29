var Shift8 = require('./node-shift8');

var t = new Shift8({
        'server':       '192.168.1.8',
        'port':         8088,
        'manager':      'manager',
        'secret':       'secret',
        'ajam':         '/mxml'
});

t.on('connected', function() {
	t.waitEvent(true);

	t.ping(function( error, response ) {
		console.log(error);
		console.log(response);
	});
});

t.on('error', function( error ) {
        console.log("Error: " + error);
});

t.on('event', function( event ) {
        console.log("Event");
        console.log(event);
});

t.on('disconnected', function() {
        console.log("Bye Bye");
});

t.login();

var Shift8 = require('./node-shift8');

var t = new Shift8({
        'server':       '192.168.1.8',
        'port':         8088,
        'manager':      'manager',
        'secret':       'secret',
        'ajam':         '/mxml'
});

t.on('connected', function() {
        console.log("Connected biatch");

        t.waitEvent(true);
});

t.on('error', function( error ) {
        console.log("FUCK: " + error);
});

t.on('event', function( event ) {
        console.log("GOT EVENT");
        console.log(event);
});

t.on('disconnected', function() {
        console.log("Bye Bye");
});

t.login();



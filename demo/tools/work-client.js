/*
 * work-client.js: HTTP client to throw load at work-server.js
 */

var mod_http = require('http');
var uris = [
	{ uri: '/fast', concurrency: 10 },
	{ uri: '/slow', concurrency: 10 },
	{ uri: '/search?q=ca', concurrency: 10 }
];

function main()
{
	var server, urispec, ii, jj;
	var parts, hostname, port;

	if (process.argv.length <= 2) {
		console.error('usage: node work-client.js <server>[:<port>]');
		console.error('   runs load against specified server/port');
		process.exit(1);
	}

	server = process.argv[2];
	parts = server.split(':');
	hostname = parts[0];
	port = parts[1] || '80';

	for (ii = 0; ii < uris.length; ii++) {
		urispec = uris[ii];
		console.log('starting load against http://%s:%s%s',
		    hostname, port, urispec['uri']);

		for (jj = 0; jj < urispec['concurrency']; jj++)
			start_load(hostname, port, urispec['uri']);
	}
}

function start_load(hostname, port, uri)
{
	mod_http.get({
		host: hostname,
		port: port,
		path: uri
	}, function (response) {
		return (start_load(hostname, port, uri));
	});
}

main();

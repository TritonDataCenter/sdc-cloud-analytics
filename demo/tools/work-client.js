/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * work-client.js: HTTP client to throw load at work-server.js
 */

var mod_http = require('http');
var uris = [
	{ uri: '/cached', concurrency: 10 },
	{ uri: '/favicon', concurrency: 10 },
	{ uri: '/search?q=slow&garbage', concurrency: 10 }
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
	/*
	 * We skip the agent to avoid node issue #877, where the agent
	 * inadvertently throttles connections.  We could also specify the
	 * connection: keep-alive header, but we prefer to emulate the behavior
	 * of many different clients.
	 */
	mod_http.get({
		host: hostname,
		port: port,
		path: uri,
		agent: false
	}, function (response) {
		return (start_load(hostname, port, uri));
	});
}

main();

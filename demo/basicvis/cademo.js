/*
 * demo.js: static-file node HTTP server for demos
 *
 * Usage: node cademo.js [[-P] server]
 *
 *    Sets up a web server on port 23183 for the CA demo.
 *
 *    If no server is specified, the demo uses a configuration service and
 *    aggregator on the same host as the demo.
 *
 *    If a server is specified with -P, the demo uses a configuration service
 *    and aggregator service on the hostname specified by "server".
 *
 *    If a server is specified but -P is not specified, the demo uses a
 *    proxy on "server" port 80 that is assumed to automatically vector to the
 *    appropriate service/port.
 */

var mod_http = require('http');
var mod_url = require('url');
var mod_path = require('path');
var mod_fs = require('fs');

var dd_index = 'graph.htm';
var dd_cwd = __dirname;
var dd_port = 23183;
var dd_vars = [];
var dd_useproxy = false;
var dd_server;

var opt_P;

var ii;

for (ii = 2; ii < process.argv.length; ii++) {
	if (process.argv[ii] == '-P') {
		opt_P = true;
		continue;
	}

	dd_server = process.argv[ii];
}

if (dd_server) {
	console.log('Cloud analytics server set to ' + dd_server);
	dd_vars.push('gServer = "' + dd_server + '"');
	if (!opt_P)
		dd_useproxy = true;
}

if (dd_useproxy) {
	console.log('Using proxy server on port 80.');
	dd_vars.push('gPortConfigsvc = 80');
	dd_vars.push('gPortAggsvc = 80');
}

mod_http.createServer(function (req, res) {
	var uri = mod_url.parse(req.url).pathname;
	var path;
	var filename;

	if (uri == '/cavars.js') {
		res.writeHead(200);
		res.end(dd_vars.join('\n'));
		return;
	}

	path = (uri == '/') ? dd_index : uri;
	filename = mod_path.join(dd_cwd, path);

	mod_fs.readFile(filename, function (err, file) {
		if (err) {
			res.writeHead(404);
			res.end();
			return;
		}

		res.writeHead(200);
		res.end(file);
	});
}).listen(dd_port, function () {
	console.log('HTTP server started on port ' + dd_port);
});

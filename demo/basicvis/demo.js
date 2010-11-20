/*
 * demo.js: static-file node HTTP server for demos
 */

var mod_http = require('http');
var mod_url = require('url');
var mod_path = require('path');
var mod_fs = require('fs');

var dd_index = 'graph.htm';
var dd_cwd = process.cwd();
var dd_port = 23183;

mod_http.createServer(function (req, res) {
	var uri = mod_url.parse(req.url).pathname;
	var path;
	var filename;

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
}).listen(dd_port);

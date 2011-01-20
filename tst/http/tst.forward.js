/*
 * Tests the implementation of caHttpForward, which given a request and response
 * as received by an HTTP server, forwards the request to a remote HTTP server
 * and forwards the response back to the client.  This test sets up two servers,
 * makes a request to the first one, and checks that the it gets back the
 * response sent by the second one.
 */

var ASSERT = require('assert');
var mod_http = require('http');

var mod_cahttp = require('../../lib/ca/ca-http');
var mod_tl = require('../../lib/tst/ca-test');

mod_tl.ctSetTimeout(5 * 1000); /* 5 seconds */

var srv1, srv2;
var srv1port = 2150, srv2port = 2151;
var uri = '/testing', method = 'GET', reqbody = 'junkdata', rspdata = 'bunk';
var rspcode = 200;
var done = false;
var log = mod_tl.ctStdout;

function setup()
{
	var listening = 0;
	var checkadvance = function () {
		if (++listening == 2)
			sendrequest();
	};

	srv1 = mod_http.createServer(proxyGotRequest);
	srv1.listen(srv1port, checkadvance);

	srv2 = mod_http.createServer(endGotRequest);
	srv2.listen(srv2port, checkadvance);
}

function proxyGotRequest(request, response)
{
	log.dbg('proxy got request; forwarding it on to server 2');
	mod_cahttp.caHttpForward(request, response, '127.0.0.1', srv2port);
}

function endGotRequest(request, response)
{
	var body = '';

	log.dbg('endpoint got request for %s %s',
	    request.method, request.url);
	ASSERT.equal(request.url, uri);
	ASSERT.equal(request.method, method);
	ASSERT.equal(request.headers['x-ca-test'], '215');

	request.on('data', function (chunk) { body += chunk; });
	request.on('end', function () {
		log.dbg('endpoint got whole request; sending response');
		ASSERT.equal(body, reqbody);
		response.writeHead(rspcode);
		response.write(rspdata);
		response.end();
	});
}

function sendrequest()
{
	mod_tl.ctHttpRequest({
		method: method,
		path: uri,
		port: srv1port,
		data: reqbody,
		headers: { 'X-CA-TEST': '215' }
	}, recvresponse);
}

function recvresponse(response, data)
{
	log.dbg('got response for initial request');
	log.dbg('headers = %j', response.headers);
	ASSERT.equal(response.statusCode, rspcode);
	ASSERT.equal(data, rspdata);
	done = true;
	srv1.close();
	srv2.close();
	process.exit(0);
}

process.on('exit', function () { ASSERT.ok(done); });

setup();

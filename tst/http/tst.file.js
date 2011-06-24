/*
 * Tests the implementation of caHttpFileServe.
 */

var mod_assert = require('assert');
var mod_fs = require('fs');
var mod_http = require('http');

var mod_cahttp = require('../../lib/ca/ca-http');
var mod_tl = require('../../lib/tst/ca-test');
var HTTP = require('../../lib/ca/http-constants');

mod_tl.ctSetTimeout(5 * 1000); /* 5 seconds */

var srv;
var srvport = 2150;
var done = false;
var log = mod_tl.ctStdout;
var filename = process.argv[1];
var contents = mod_fs.readFileSync(filename);

function setup()
{
	srv = new mod_cahttp.caHttpServer({
	    port: srvport,
	    log: mod_tl.ctStdout,
	    router: function (server) {
		server.get('/', function (request, response) {
			mod_cahttp.caHttpFileServe(request, response, filename);
		});
	    }
	});

	srv.start(mod_tl.advance);
}

function sendrequest()
{
	mod_tl.ctHttpRequest({ method: 'GET', path: '/', port: srvport },
	    mod_tl.advance);
}

function recvresponse(err, response, data)
{
	if (err)
		throw (err);

	mod_assert.equal(response.statusCode, HTTP.OK);
	mod_assert.equal(data, contents);
	mod_tl.advance();
}

function sendfail()
{
	filename += 'nonexistent';
	sendrequest();
}

function recvfail(err, response)
{
	if (err)
		throw (err);

	mod_assert.ok(response.statusCode > HTTP.EBADREQUEST);
	mod_tl.advance();
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(sendrequest);
mod_tl.ctPushFunc(recvresponse);
mod_tl.ctPushFunc(sendfail);
mod_tl.ctPushFunc(recvfail);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();

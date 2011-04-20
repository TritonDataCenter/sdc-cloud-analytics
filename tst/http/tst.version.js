/*
 * Tests the API version code in caHttp.
 */

var mod_assert = require('assert');
var mod_sys = require('sys');

var mod_cahttp = require('../../lib/ca/ca-http');
var mod_tl = require('../../lib/tst/ca-test');
var HTTP = require('../../lib/ca/http-constants');

mod_tl.ctSetTimeout(5 * 1000); /* 5 seconds */

var srv, port = 8085;
var log = mod_tl.ctStdout;

function router(server)
{
	server.get('/', gotrequest);
}

function setup()
{
	srv = new mod_cahttp.caHttpServer({
	    log: log,
	    router: router,
	    port: port
	});

	srv.start(mod_tl.advance);
}

mod_tl.ctPushFunc(setup);

var test_cases = [ {
	head: 'ca/a',
	status: HTTP.ECONFLICT
}, {
	head: 'foo/0.1.0',
	status: HTTP.ECONFLICT
}, {
	head: '2011-04-11',
	status: HTTP.ECONFLICT
}, {
	head: 'ca/0.1',
	status: HTTP.ECONFLICT
}, {
	head: 'ca/0.1.0',
	status: HTTP.OK,
	major: '0', minor: '1', micro: '0'
}, {
	head: 'ca/3.1.5',
	status: HTTP.OK,
	major: '3', minor: '1', micro: '5'
}, {
	/* no head specified */
	status: HTTP.OK,
	major: '0', minor: '1', micro: '0'
} ];

function runtests()
{
	var ii;

	for (ii = 0; ii < test_cases.length; ii++) {
		mod_tl.ctPushFunc(maketest(test_cases[ii], 'X-API-Version'));
		mod_tl.ctPushFunc(maketest(test_cases[ii], 'X-API-version'));
		mod_tl.ctPushFunc(maketest(test_cases[ii], 'x-api-version'));
	}

	mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
	mod_tl.advance();
}

mod_tl.ctPushFunc(runtests);
mod_tl.advance();

function maketest(testcase, headname)
{
	var ret, headers = {};

	if ('head' in testcase)
		headers[headname] = testcase['head'];

	ret = function () {

		return (mod_tl.ctHttpRequest({
		    method: 'GET',
		    path: '/',
		    port: port,
		    headers: headers
		}, function (err, response, data) {
			mod_assert.equal(response.statusCode,
			    testcase['status']);
			mod_tl.advance();
		}));
	};

	ret.caFunctionName = 'header ' + mod_sys.inspect(headers);

	return (ret);
}

function gotrequest(request, response)
{
	var ii, testcase;

	mod_assert.ok(request.ca_api_vers.length > 0);

	/*
	 * We deliberately iterate only N-1 testcases.  If we don't find the
	 * matching one, we use the last one.
	 */
	for (ii = 0; ii < test_cases.length - 1; ii++) {
		if (test_cases[ii]['head'] == request.ca_api_vers)
			break;
	}

	testcase = test_cases[ii];
	mod_tl.ctStdout.info('verifying status, major/minor/micro for "%s" ' +
	    '(%s/%s/%s)', request.ca_api_vers, request.ca_api_major,
	    request.ca_api_minor, request.ca_api_micro);
	mod_assert.equal(testcase['status'], HTTP.OK);
	mod_assert.equal(testcase['major'], request.ca_api_major);
	mod_assert.equal(testcase['minor'], request.ca_api_minor);
	mod_assert.equal(testcase['micro'], request.ca_api_micro);
	response.send(HTTP.OK);
}

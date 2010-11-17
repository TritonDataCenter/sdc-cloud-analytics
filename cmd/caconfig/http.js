/*
 * caconfig/http: Config service HTTP server.
 *
 * This component runs the HTTP service, dispatching requests to the rest of
 * the server.
 */

var mod_sys = require('sys');
var mod_http = require('http');
var mod_events = require('events');

var HTTP = require('http-constants');

var cfg_http_maxentity	= 4 * 1024;		/* maximium request size: 4K */

/*
 * Convert an absolute URI into an array of non-empty strings representing the
 * URI's components.  For example, converts '/foo/bar//bug/' to [ 'foo', 'bar',
 * 'bug' ].  Returns undefined if the URI is malformed.
 */
function cfgHttpUriToComponents(uri)
{
	var parts = uri.split('/');
	var ii = 0;
	var ret = [];

	/* Check for non-absolute URIs. */
	if (parts[0] !== '')
		return (undefined);

	for (ii = 1; ii < parts.length; ii++) {
		if (parts[ii].length > 0)
			ret.push(parts[ii]);
	}

	return (ret);
}

/*
 * Manages the HTTP interaction for this service.  This doesn't do anything
 * until the 'start' method is invoked.  The 'conf' argument must contain the
 * following member:
 *
 *	port		Local TCP port on which to serve HTTP
 *
 * This object emits an event for each received request.  Event listener
 * functions receive two arguments:
 *
 *	args		Object specifying additional named arguments.  The set
 *			of available named arguments is specific to each event.
 *
 *	callback	Function to be invoked when servicing this request is
 *			complete.  This function MUST be invoked within a
 *			reasonable time after the listener is invoked, since
 *			clients are waiting on the response.  The function is
 *			invoked as
 *
 *				callback(code, result[, headers])
 *
 *			'code' will be used as the HTTP response code.  'result'
 *			will be serialized and sent back to the client.
 *			'result' could reasonably be a Javascript object
 *			representing a resource or a simple string (as an error
 *			message, for example).  If specified, 'headers' will be
 *			sent as HTTP headers with the response.
 *
 * Events include:
 *
 *	inst-create	Request received to create a new instrumentation.
 *			Named arguments: username, inst spec
 *
 *	inst-value	Request received to retrieve instrumentation value.
 *			Named arguments: username, inst id
 *
 *	inst-delete	Request received to destroy an instrumentation.
 *			Named arguments: username, inst id
 */
function caConfigHttp(conf)
{
	var cfghttp = this;

	mod_events.EventEmitter.call(this);
	this.cah_port = conf.port;
	this.cah_server = mod_http.createServer(
	    function (request, response) {
		cfghttp.gotRequest(request, response);
	    });
}

mod_sys.inherits(caConfigHttp, mod_events.EventEmitter);
exports.caConfigHttp = caConfigHttp;

caConfigHttp.prototype.start = function (callback)
{
	this.cah_server.listen(this.cah_port, callback);
};

/*
 * Invoked when we initially receive a request.  Slurps in the entity-body and
 * then invokes the next routine to actually process the request.
 */
caConfigHttp.prototype.gotRequest = function (request, response)
{
	var cfghttp = this;
	var reqdata = '';

	/*
	 * We shouldn't be getting large requests, so we slurp it all in at
	 * once.  If it's bigger than 4K, though, we bomb out to avoid someone
	 * shoving too much data at us.
	 */
	request.on('data', function (chunk) {
		if (reqdata.length + chunk.length > cfg_http_maxentity) {
			response.writeHead(HTTP.ETOOLARGE, HTTP.MSG_ETOOLARGE);
			response.end();
			request.destroy(); /* XXX */
			return;
		}

		reqdata += chunk;
	});

	request.on('end', function () {
		request.cfg_reqdata = reqdata;
		cfghttp.processRequest(request, response, reqdata);
	});
};

/*
 * Invoked after we've finished reading the request to actually process it.
 */
caConfigHttp.prototype.processRequest = function (request, response, reqdata)
{
	var cfghttp = this;
	var parts = cfgHttpUriToComponents(request.url);
	var part;
	var callback = function (code, data, headers) {
	    cfghttp.sendResponse(response, code, data, headers);
	};

	if (!parts)
		return (callback(HTTP.EBADREQUEST,
		    'error: expected absolute URI'));

	if ((part = parts.shift()) != 'instrumentation')
		return (callback(HTTP.ENOTFOUND,
		    'error: requested resource was not found'));

	if (parts.length === 0)
		return (this.createInst(request, reqdata, callback));

	part = parts.shift();

	if (parts.length > 1)
		return (callback(HTTP.ENOTFOUND,
		    'error: the requested resource was not found'));

	return (this.processInst(request, part, parts, reqdata, callback));
};

caConfigHttp.prototype.sendResponse = function (response, code, data, headers)
{
	var rspdata;

	if (headers)
		response.writeHead(code, headers);
	else
		response.writeHead(code); /* XXX */

	if (!data)
		rspdata = '';
	else if (typeof (data) == typeof (''))
		rspdata = data;
	else
		rspdata = JSON.stringify(data);

	response.end(rspdata);
};

caConfigHttp.prototype.createInst = function (request, reqdata, callback)
{
	/*
	 * For now, we only use the JSON interface.
	 */
	var instspec;

	if (request.method != 'POST') {
		callback(HTTP.EBADMETHOD, HTTP.MSG_EBADMETHOD,
		    { 'Allow': 'POST' });
		return;
	}

	try {
		instspec = JSON.parse(reqdata);
		this.emit('inst-create', { spec: instspec }, callback);
	} catch (ex) {
		callback(HTTP.ESERVER,
		    'error: failed to create instrumentation: ' + ex.message);
	}
};

caConfigHttp.prototype.processInst = function (request, instid, uri,
    reqdata, callback)
{
	if (uri.length === 0) {
		if (request.method != 'DELETE') {
			callback(HTTP.EBADMETHOD, HTTP.MSG_EBADMETHOD,
			    { 'Allow': 'DELETE' });
			return;
		}

		this.emit('inst-delete', { instid: instid }, callback);
		return;
	}

	if (uri.length > 1) {
		callback(HTTP.ENOTFOUND,
		    'error: requested resource was not found');
		return;
	}

	switch (uri[0]) {
	case 'value':
		if (request.method != 'GET') {
			callback(HTTP.EBADMETHOD, HTTP.MSG_EBADMETHOD,
			    { 'Allow': 'GET' });
			return;
		}

		this.emit('inst-value', { instid: instid }, callback);
		break;

	default:
		callback(HTTP.ENOTFOUND,
		    'error: requested resource was not found');
		break;
	}
};

/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * calib.js: used by the tools here
 */

var mod_http = require('http');
var mod_querystring = require('querystring');
var mod_sys = require('sys');

var ca_host = '127.0.0.1';
var ca_port = '23181';
var ca_base = '/ca/instrumentations';

function caRequest(method, uri, callback)
{
	var request = mod_http.request({
		host: ca_host,
		port: ca_port,
		path: ca_base + uri,
		method: method
	});

	request.on('error', function (err) {
		callback(new Error('request failed: ' + err.message));
	});

	request.on('response', function (response) {
		var body = '';

		response.on('data', function (chunk) { body += chunk; });
		response.on('end', function () {
			var json;

			if (response.statusCode != 200) {
				callback(new Error('request failed with code ' +
				    response.statusCode + ': ' + body));
				return;
			}

			try {
				json = JSON.parse(body);
			} catch (ex) {
				callback(new Error(
				    'failed to parse response JSON: ' +
				    ex.message));
				return;
			}

			callback(null, json);
		});
	});

	request.end();
}

exports.caListInstrumentations = function caListInstrumentations(callback)
{
	caRequest('GET', '/', callback);
};

exports.caInstnModify = function caInstnModify(instnid, props, callback)
{
	var query;

	query = mod_querystring.stringify(props);
	caRequest('PUT', '/' + instnid + '?' + query, callback);
};

/*
 * XXX - ripped out of CA gate
 */
function caSprintf(fmt)
{
	var regex = [
	    '([^%]*)',				/* non-special */
	    '%',				/* start of format */
	    '([\'\\-+ #0]*?)',			/* flags (optional) */
	    '([1-9]\\d*)?',			/* width (optional) */
	    '(\\.([1-9]\\d*))?',		/* precision (optional) */
	    '[lhjztL]*?',			/* length mods (ignored) */
	    '([diouxXfFeEgGaAcCsSp%jr])'	/* conversion */
	].join('');

	var re = new RegExp(regex);
	var args = Array.prototype.slice.call(arguments, 1);
	var flags, width, precision, conversion;
	var left, pad, sign, arg, match;
	var ret = '';
	var argn = 1;

	while ((match = re.exec(fmt)) !== null) {
		ret += match[1];
		fmt = fmt.substring(match[0].length);

		flags = match[2] || '';
		width = match[3] || 0;
		precision = match[4] || '';
		conversion = match[6];
		left = false;
		sign = false;
		pad = ' ';

		if (conversion == '%') {
			ret += '%';
			continue;
		}

		if (args.length === 0)
			throw (new Error('too few args to sprintf'));

		arg = args.shift();
		argn++;

		if (flags.match(/[\' #]/))
			throw (new Error(
			    'unsupported flags: ' + flags));

		if (precision.length > 0)
			throw (new Error(
			    'non-zero precision not supported'));

		if (flags.match(/-/))
			left = true;

		if (flags.match(/0/))
			pad = '0';

		if (flags.match(/\+/))
			sign = true;

		switch (conversion) {
		case 's':
			if (arg === undefined || arg === null)
				throw (new Error('argument ' + argn +
				    ': attempted to print undefined or null ' +
				    'as a string'));
			ret += doPad(pad, width, left, arg);
			break;

		case 'd':
			arg = Math.floor(arg);
			/*jsl:fallthru*/
		case 'f':
			sign = sign && arg > 0 ? '+' : '';
			ret += sign + doPad(pad, width, left,
			    arg.toString());
			break;

		case 'j': /* non-standard */
			if (width === 0)
				width = 10;
			ret += mod_sys.inspect(arg, false, width);
			break;

		case 'r': /* non-standard */
			ret += dumpException(arg);
			break;

		default:
			throw (new Error('unsupported conversion: ' +
			    conversion));
		}
	}

	ret += fmt;
	return (ret);
}

exports.caSprintf = caSprintf;
global.caSprintf = caSprintf;

function doPad(chr, width, left, str)
{
	var ret = str;

	while (ret.length < width) {
		if (left)
			ret += chr;
		else
			ret = chr + ret;
	}

	return (ret);
}

function dumpException(ex)
{
	var ret;

	if (!(ex instanceof Error))
		throw (new Error(caSprintf('invalid type for %%r: %j', ex)));

	/*
	 * Note that V8 prepends "ex.stack" with ex.toString().
	 */
	ret = 'EXCEPTION: ' + ex.constructor.name + ': ' + ex.stack;

	if (!ex.cause)
		return (ret);

	for (ex = ex.cause(); ex; ex = ex.cause ? ex.cause() : null)
		ret += '\nCaused by: ' + dumpException(ex);

	return (ret);
}

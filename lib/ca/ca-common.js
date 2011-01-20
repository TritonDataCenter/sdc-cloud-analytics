/*
 * ca.js: Cloud Analytics system constants and common routines.
 */

var ASSERT = require('assert');
var mod_sys = require('sys');
var mod_uname = require('uname');

/*
 * We use only one global exchange of type 'topic'.
 */
exports.ca_amqp_exchange 		= 'amq.topic';
exports.ca_amqp_exchange_opts		= { type: 'topic' };

/*
 * Components on the AMQP network (config service, aggregators, and
 * instrumenters) each create their own key which encodes their type and a
 * unique identifier (usually hostname).
 */
exports.ca_amqp_key_base_aggregator	= 'ca.aggregator.';
exports.ca_amqp_key_base_config		= 'ca.config.';
exports.ca_amqp_key_base_instrumenter	= 'ca.instrumenter.';
exports.ca_amqp_key_base_tool		= 'ca.tool.';

/*
 * Each instrumentation gets its own key, which exactly one aggregator
 * subscribes to.  This facilitates distribution of instrumentation data
 * processing across multiple aggregators.
 */
var ca_amqp_key_base_instrumentation = 'ca.instrumentation.';

exports.caKeyForInst = function (id)
{
	return (ca_amqp_key_base_instrumentation + id);
};

/*
 * To facilitate autoconfiguration, each component only needs to know about this
 * global config key.  Upon startup, a component sends a message to this key.
 * The configuration service receives these messages and responds with any
 * additional configuration data needed for this component.
 */
exports.ca_amqp_key_config 		= 'ca.config';

/*
 * On startup, the configuration service broadcasts to everyone to let them know
 * that it has (re)started.
 */
exports.ca_amqp_key_all			= 'ca.broadcast';

/*
 * Unlike the constants above, this default broker is specific to the deployment
 * environment.  But it's used in lots of places and this is the best place for
 * it.
 */
exports.caBroker = function ()
{
	var broker;

	if (!process.env['AMQP_HOST'])
		throw (new Error('AMQP_HOST not specified'));

	broker = {};
	broker.host = process.env['AMQP_HOST'];

	if (process.env['AMQP_LOGIN'])
		broker.login = process.env['AMQP_LOGIN'];
	if (process.env['AMQP_PASSWORD'])
		broker.password = process.env['AMQP_PASSWORD'];
	if (process.env['AMQP_VHOST'])
		broker.vhost = process.env['AMQP_VHOST'];
	if (process.env['AMQP_PORT'])
		broker.port = process.env['AMQP_PORT'];

	return (broker);
};

/*
 * Like the AMQP broker, the MAPI service is configured via environment
 * variables.  But we don't supply defaults for these, since they are actually
 * sensitive.
 */
exports.caMapiConfig = function ()
{
	if (!process.env['MAPI_HOST'] ||
	    !process.env['MAPI_PORT'] ||
	    !process.env['MAPI_USER'] ||
	    !process.env['MAPI_PASSWORD'])
		return (undefined);

	return ({
		host: process.env['MAPI_HOST'],
		port: process.env['MAPI_PORT'],
		user: process.env['MAPI_USER'],
		password: process.env['MAPI_PASSWORD']
	});
};

/*
 * The Cloud Analytics API is versioned with a major and minor number.  Software
 * components should ignore messages received with a newer major version number.
 */
exports.ca_amqp_vers_major		= 1;
exports.ca_amqp_vers_minor		= 1;

exports.caIncompatible = function (msg)
{
	return (msg.ca_major !== exports.ca_amqp_vers_major);
};

/*
 * Retry timeout and count: these parameters determine how hard we try to
 * recover when the AMQP broker disappears.
 */
exports.ca_amqp_retry_count		= 3;
exports.ca_amqp_retry_interval		= 5 * 1000; /* 5ms */

exports.caSysinfo = function (agentname, agentversion)
{
	var uname = mod_uname.uname();
	var hostname;

	if ('HOST' in process.env && process.env['HOST'].length > 0)
		hostname = process.env['HOST'];
	else
		hostname = uname['nodename'];

	return ({
	    ca_agent_name: agentname,
	    ca_agent_version: agentversion,
	    ca_os_name: uname['sysname'],
	    ca_os_release: uname['release'],
	    ca_os_revision: uname['version'],
	    ca_hostname: hostname,
	    ca_major: exports.ca_amqp_vers_major,
	    ca_minor: exports.ca_amqp_vers_minor
	});
};

/*
 * Deep copy an acyclic *basic* Javascript object.  This only handles basic
 * scalars (strings, numbers, booleans) and arbitrarily deep arrays and objects
 * containing these.  This does *not* handle instances of other classes.
 */
exports.caDeepCopy = function (obj)
{
	var ret, key;
	var marker = '__caDeepCopy';

	if (obj && obj[marker])
		throw (new Error('attempted deep copy of cyclic object'));

	if (obj && obj.constructor == Object) {
		ret = {};
		obj[marker] = true;

		for (key in obj) {
			if (key == marker)
				continue;

			ret[key] = exports.caDeepCopy(obj[key]);
		}

		delete (obj[marker]);
		return (ret);
	}

	if (obj && obj.constructor == Array) {
		ret = [];
		obj[marker] = true;

		for (key = 0; key < obj.length; key++)
			ret.push(exports.caDeepCopy(obj[key]));

		delete (obj[marker]);
		return (ret);
	}

	/*
	 * It must be a primitive type -- just return it.
	 */
	return (obj);
};

/*
 * Deep copies each of the keys of 'source' into 'obj'.
 */
exports.caDeepCopyInto = function (obj, source)
{
	var key;

	for (key in source)
		obj[key] = exports.caDeepCopy(source[key]);
};

/*
 * Throws an Error with a reasonable message if the specified key does not exist
 * in the object.  If 'prototype' is specified, throws an Error if the type of
 * obj[key] doesn't match the TYPE of 'prototype'.  Returns obj[key].
 */
exports.caFieldExists = function (obj, key, prototype)
{
	if (!(key in obj))
		throw (new Error('missing required field: ' + key));

	if (arguments.length > 2 &&
	    typeof (obj[key]) != typeof (prototype))
		throw (new Error('field has wrong type: ' + key));

	return (obj[key]);
};

exports.caIsEmpty = function (obj)
{
	var key;

	for (key in obj)
		return (false);
	return (true);
};

/*
 * Stripped down version of s[n]printf(3c).  We make a best effort to throw an
 * exception when given a format string we don't understand, rather than
 * ignoring it, so that we won't break existing programs if/when we go implement
 * the rest of this.
 *
 * This implementation currently supports specifying
 *	- field alignment ('-' flag),
 * 	- zero-pad ('0' flag)
 *	- always show numeric sign ('+ flag),
 *	- field width
 *	- conversions for strings, decimal integers, and floats (numbers).
 *	- argument size specifiers.  These are all accepted but ignored, since
 *	  Javascript has no notion of the physical size of an argument.
 *
 * Everything else is currently unsupported, most notably precision, unsigned
 * numbers, non-decimal numbers, and characters.
 */
exports.caSprintf = function (fmt)
{
	var regex = [
	    '([^%]*)',			/* non-special */
	    '%',			/* start of format */
	    '([\'\\-+ #0]*?)',		/* flags (optional) */
	    '([1-9]\\d*)?',		/* width (optional) */
	    '(\\.([1-9]\\d*))?',	/* precision (optional) */
	    '[lhjztL]*?',		/* length mods (ignored) */
	    '([diouxXfFeEgGaAcCsSp%j])'	/* conversion */
	].join('');

	var re = new RegExp(regex);
	var args = Array.prototype.slice.call(arguments, 1);
	var flags, width, precision, conversion;
	var left, pad, sign, arg, match;
	var ret = '';

	ASSERT.equal('string', typeof (fmt));

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

		default:
			throw (new Error('unsupported conversion: ' +
			    conversion));
		}
	}

	ret += fmt;
	return (ret);
};

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

exports.caFormatDate = function (now)
{
	return (exports.caSprintf('%4d-%02d-%02d %02d:%02d:%02d.%03d UTC',
	    now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(),
	    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(),
	    now.getUTCMilliseconds()));
};

exports.caNoop = function () {};

/*
 * Given a customer identifier and per-customer instrumentation identifier,
 * return the fully qualified instrumentation id.  If custid is undefined, it is
 * assumed that instid refers to the global scope.  For details, see the block
 * comment at the top of this file on cfg_insts.
 */
exports.caQualifiedId = function (custid, instid)
{
	if (custid === undefined)
		return ('global;' + instid);

	return ('cust:' + custid + ';' + instid);
};

/*
 * ca-error.js: common error handling functions and classes
 */

var mod_ca = require('./ca-common');
var ASSERT = require('assert');

/*
 * Available error codes and their default messages.  These codes are available
 * as variables in the global context.
 */
var caErrorMessages = {
    'ECA_INVAL':	'invalid argument',
    'ECA_NORESOURCE':	'insufficient resources',
    'ECA_REMOTE':	'remote service failure',
    'ECA_TIMEDOUT':	'timed out'
};

var errcode;
for (errcode in caErrorMessages)
	global[errcode] = errcode;

/*
 * Generic error class.  The constructor is invoked as (code, wrapped, ...)
 * where:
 *
 *	code	is one of the defined codes above
 *
 *	wrapped	(optional) wrapped exception, usually representing the cause
 *
 *	... 	(optional) processed by caSprintf() and used as the exception's
 *		message.
 */
function caError(code, wrapped)
{
	var args, msg, longmsg;

	ASSERT.ok(code);
	ASSERT.ok(code in caErrorMessages);

	args = Array.prototype.slice.call(arguments, 2);
	if (args.length > 0)
		msg = caSprintf.apply(null, args);
	else
		msg = caErrorMessages[code];

	if (wrapped)
		longmsg = msg + ': ' + wrapped.message;
	else
		longmsg = msg;

	Error.apply(this, [ msg ]);
	this.code = code;
	this.message = msg;
	this.wrapped = wrapped;
	this.summary = longmsg;

	if (Error.captureStackTrace)
		Error.captureStackTrace(this);
}

caError.prototype = new Error();
caError.prototype.constructor = caError;
caError.prototype.name = 'caError';

exports.caError = caError;
global.caError = caError;

caError.prototype.toString = function ()
{
	return (this.summary);
};

caError.prototype.code = function ()
{
	return (this.code);
};

caError.prototype.cause = function ()
{
	return (this.wrapped);
};

caError.prototype.stacktrace = function ()
{
	return (this.stack);
};

/*
 * caValidationErrors represent user input errors.
 *
 * caInvalidFieldError should be preferred to caValidationError because it
 * provides uniformity in both human-readable error messages and programmatic
 * access to data like the field that was invalid and why it was invalid.
 */
function caValidationError(msg)
{
	caError.apply(this, [ ECA_INVAL, null, msg ]);
}

caValidationError.prototype = new caError(ECA_INVAL);
caValidationError.prototype.constructor = caValidationError;
caValidationError.prototype.name = 'caValidationError';

exports.caValidationError = caValidationError;
global.caValidationError = caValidationError;


/*
 * Represents a validation error where a particular field has a missing or
 * illegal value.  Constructed as caInvalidFieldError(field, value, ...), where
 * the remaining arguments are processed by caSprintf to form the reason why the
 * value is invalid.  If no reason is specified, a default is provided.
 */
function caInvalidFieldError(field, value)
{
	var args;

	this.civ_field = field;
	this.civ_value = value;

	if (value === undefined) {
		this.civ_reason = 'missing';
		caValidationError.apply(this, [ caSprintf(
		    'missing value for required field: "%s"', field) ]);
		return;
	}

	args = Array.prototype.slice.call(arguments, 2);
	if (args.length > 0)
		this.civ_reason = caSprintf.apply(null, args);
	else
		this.civ_reason = 'illegal value';

	caValidationError.apply(this, [ caSprintf(
	    'value "%s" for field "%s" is invalid: %s', value, field,
	    this.civ_reason) ]);
}

caInvalidFieldError.prototype = new caValidationError(ECA_INVAL);
caInvalidFieldError.prototype.constructor = caInvalidFieldError;
caInvalidFieldError.prototype.name = 'caInvalidFieldError';

exports.caInvalidFieldError = caInvalidFieldError;
global.caInvalidFieldError = caInvalidFieldError;

caInvalidFieldError.prototype.field = function ()
{
	return (this.civ_field);
};

caInvalidFieldError.prototype.value = function ()
{
	return (this.civ_value);
};

caInvalidFieldError.prototype.reason = function ()
{
	return (this.civ_reason);
};

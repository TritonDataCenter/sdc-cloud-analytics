/*
 * ca-log: common logging utilities
 */

var mod_assert = require('assert');

var mod_dbg = require('./ca-dbg');
var mod_ca = require('./ca-common');
var mod_fs = require('fs');

var ca_log_bufsz = 1024 * 1024;	/* don't buffer more than this much */

/*
 * Logs messages to the specified writer in a standard format.  'conf' must
 * specify the following member:
 *
 *	out		writable stream
 *
 * The following members may also be specified:
 *
 *	level		log level to record; may be one of
 *
 *				caLog.DBG, caLog.INFO, caLog.WARN, caLog.ERROR
 *
 *			When the log level is set to one of these levels, all
 *			messages at that level and previous levels will be
 *			recorded.
 *
 *	candrop		true if this log is allowed to drop messages when they
 *			start buffering
 */
function caLog(conf)
{
	var log = this;

	this.l_out = conf.out;
	this.l_level = conf.level || caLog.DBG;
	this.l_candrop = conf.candrop || false;
	this.l_bytesbuffered = 0;
	this.l_flushers = [];
	this.l_drops = 0;

	this.l_out.on('drain', function () {
		log.l_bytesbuffered = 0;
		while (log.l_flushers.length > 0)
			(log.l_flushers.pop())();

		if (log.l_drops > 0) {
			log.warn('log dropped %d messages', log.l_drops);
			log.l_drops = 0;
		}
	});
}

exports.caLog = caLog;

caLog.DBG   = { num: 10, label: 'DBG' };
caLog.INFO  = { num: 20, label: 'INFO' };
caLog.WARN  = { num: 30, label: 'WARN' };
caLog.ERROR = { num: 50, label: 'ERROR' };

caLog.prototype.dbg = function ()
{
	this.dolog(caLog.DBG, arguments);
};

caLog.prototype.info = function ()
{
	this.dolog(caLog.INFO, arguments);
};

caLog.prototype.error = function ()
{
	this.dolog(caLog.ERROR, arguments);
};

caLog.prototype.warn = function ()
{
	this.dolog(caLog.WARN, arguments);
};

caLog.prototype.dolog = function (level, args)
{
	if (this.l_level.num > level.num)
		return;

	if (this.l_candrop && this.l_bytesbuffered > ca_log_bufsz) {
		this.l_drops++;
		return;
	}

	var usertext = mod_ca.caSprintf.apply(null, args);
	var now = new Date();

	var entry = mod_ca.caSprintf('[%s] %-5s  %s\n',
	    mod_ca.caFormatDate(now), level.label, usertext);

	if (!this.l_out.write(entry))
		this.l_bytesbuffered += entry.length;
};

caLog.prototype.flush = function (callback)
{
	if (this.l_bytesbuffered === 0)
		callback();

	this.l_flushers.push(callback);
};

/*
 * Creates a logger logging to the specified file.
 */
function caLogFromFile(filename, logoptions, callback)
{
	var opened, hdl, options;

	opened = false;
	hdl = mod_fs.createWriteStream(filename, { flags: 'a' });
	hdl.on('open', function () { opened = true; });
	hdl.on('error', function (err) {
		if (!opened)
			return (callback(new caError(ECA_INVAL, err,
			    'failed to open log file at "%s"', filename)));
		return (callback(new caError(ECA_IO, err,
		    'asynchronous error on log "%s"', filename)));
	});

	options = caDeepCopy(logoptions);
	options.out = hdl;
	return (new caLog(options));
}

exports.caLogFromFile = caLogFromFile;

/*
 * Returns a function that logs the given error.  If the error occurred during
 * open, bomb out.
 */
function caLogError(log)
{
	return (function (err) {
		log.error('%r', err);
		if (err.code() == ECA_INVAL)
			caPanic('error opening log file', err);
	});
}

exports.caLogError = caLogError;

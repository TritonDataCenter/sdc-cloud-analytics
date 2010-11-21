/*
 * ca-log: common logging utilities
 */

var mod_ca = require('ca');

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
 */
function caLog(conf)
{
	this.l_out = conf.out;
	this.l_level = conf.level || caLog.INFO;
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
	if (this.l_level.num > level)
		return;

	var usertext = mod_ca.caSprintf.apply(null, args);
	var now = new Date();

	var entry = mod_ca.caSprintf('[%s] %-5s  %s\n',
	    mod_ca.caFormatDate(now), level.label, usertext);

	this.l_out.write(entry);
};

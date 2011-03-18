/*
 * ca-dbg.js: debugging facilities
 */

var mod_fs = require('fs');
var mod_ca = require('./ca-common');

/*
 * A post-mortem debugging facility is critical in any programming environment
 * to be able to root-cause issues that occur in production from the artifacts
 * of a single failure.  Without it, tracking down problems becomes a laborious
 * process of adding "print" statements to gather data to prove/disprove
 * hypotheses, trying to reproduce the problem, and repeating until enough data
 * is gathered to root-cause the issue.  For reproducible problems, this process
 * is merely painful for developers, administrators, and customers alike.  For
 * unreproducible problems, this is untenable.
 *
 * Sadly, Javascript (or node/V8, more precisely), like most dynamic languages,
 * has no built-in post-mortem debugging facility, so we implement our own here.
 * The basic idea is to maintain a global object that references all of the
 * internal state we would want for debugging.  Then when our application
 * panics (crashes), we serialize this state, dump it to a file, and then exit.
 * Note that while the program is panicking, we don't invoke debugging code
 * inside other components; modules must register objects *before* the panic in
 * order to have them saved during the panic.  This is tenable because we're
 * only storing references, so consumers can continue modifying their objects
 * after registering them.  This is necessary to minimize the amount of code
 * that must work correctly during the panic.
 *
 * Since we want all components in CA to be able to save debugging state without
 * having to pass context pointers around everywhere, we supply a global object
 * called caDbg to which program state can be attached via the following
 * methods:
 *
 * 	set(name, state)	Adds a new debugging key called "name" and
 * 				associates "state" with that key.  If "name" is
 * 				already being used, the previous association is
 * 				replaced with the new one.  This key-value pair
 * 				will be serialized and dumped when the program
 * 				crashes.  Assuming "state" is a reference type,
 * 				the caller can modify this object later and such
 * 				updates will be reflected in the serialized
 * 				state when the program crashes.
 *
 * 	add(name, state)	Like set(name, state), but ensures that the new
 * 				key does not conflict with an existing key by
 * 				adding a unique identifier to it.  Returns the
 * 				actual key that was used for subsequent use in
 * 				"remove".
 *
 * 	remove(name)		Removes an existing association.
 *
 * 	dump()			Returns the serialized debug state.  This should
 * 				generally not be used except by the panic code
 * 				itself and test code since it may modify the
 * 				debug state.
 */
function caDebugState()
{
	var now = new Date();

	this.cds_state = {};
	this.cds_ids = {};

	this.set('dbg.format-version', '0.1');
	this.set('init.process.argv', process.argv);
	this.set('init.process.pid', process.pid);
	this.set('init.process.cwd', process.cwd());
	this.set('init.process.env', process.env);
	this.set('init.process.version', process.version);
	this.set('init.process.platform', process.platform);
	this.set('init.time', now);
	this.set('init.time-ms', now.getTime());
}

caDebugState.prototype.set = function (name, state)
{
	this.cds_state[name] = state;
};

caDebugState.prototype.add = function (name, state)
{
	var ii;

	if (!this.cds_ids[name])
		this.cds_ids[name] = 1;

	for (ii = this.cds_ids[name]; ; ii++) {
		if (!((name + ii) in this.cds_state))
			break;
	}

	this.cds_ids[name] = ii + 1;
	this.set(name + ii, state);
	return (name + ii);
};

caDebugState.prototype.remove = function (name)
{
	delete (this.cds_state[name]);
};

caDebugState.prototype.dump = function ()
{
	/*
	 * JSON.stringify() does not deal with circular structures, so we have
	 * to explicitly remove such references here.  It would be nice if we
	 * could encode these properly, but we'll need something more
	 * sophisticated than JSON.  We're allowed to stomp on the state
	 * in-memory here because we're only invoked in the crash path.
	 */
	caRemoveCircularRefs(this.cds_state);
	return (JSON.stringify(this.cds_state));
};

/*
 * Causes the current program to dump saved program state before crashing.
 */
function caEnablePanicOnCrash()
{
	process.on('uncaughtException', function (ex) {
	    caPanic('panic due to uncaught exception', ex);
	});
}

exports.caEnablePanicOnCrash = caEnablePanicOnCrash;

/*
 * Invoked when an uncaught exception bubbles back to the event loop.  Remember
 * that node doesn't exit if we've specified a handler, so we must explicitly
 * exit ourselves.  Additionally, we can't do anything asynchronous here because
 * the event loop must be considered dead.
 */
function caPanic(str, err)
{
	var msg;

	msg = caPanicWriteSafeError('CA PANIC: ' + str, err);

	try {
		caDbg.set('panic.error', msg);
		caDoPanic();
	} catch (ex) {
		caPanicWriteSafeError('error during panic', ex);
	}

	process.exit(1);
}

exports.caPanic = caPanic;
global.caPanic = caPanic;

function caPanicWriteSafeError(msg, err)
{
	var errstr;

	try {
		errstr = caSprintf('%r', err);
	} catch (ex) {
		errstr = (err && err.message && err.stack) ?
		    err.message + '\n' + err.stack : '<unknown error>';
	}

	caPanicLog(msg + ': ' + errstr);
	return (errstr);
}

function caPanicLog(msg)
{
	process.stderr.write('[' + mod_ca.caFormatDate(new Date()) + ']' +
	    ' CRIT   ' + msg + '\n');
}

function caDoPanic(err)
{
	var when, filename;

	when = new Date();
	caDbg.set('panic.time', when);
	caDbg.set('panic.time-ms', when.getTime());
	caDbg.set('panic.memusage', process.memoryUsage());

	/*
	 * If we had child.execSync(), we could get pfiles. :(
	 */

	filename = 'cacore.' + process.pid;
	caPanicLog('writing core dump to ' + process.cwd() + '/' + filename);
	caPanicSave(filename);
	caPanicLog('finished writing core dump');
}

/*
 * Saves a "core dump" to the named file.  This is exported for testing only.
 */
function caPanicSave(filename)
{
	var dump = caDbg.dump();
	mod_fs.writeFileSync(filename, dump);
}

exports.caPanicSave = caPanicSave;

/*
 * We want there to be exactly one instance of caDebugState used at all times,
 * even if this module is loaded multiple times.  That has to be the global one
 * (global.caDbg).  We do export our constructor, but only for testing purposes.
 */
exports.caDebugState = caDebugState;

if (!global.caDbg)
	global.caDbg = new caDebugState();

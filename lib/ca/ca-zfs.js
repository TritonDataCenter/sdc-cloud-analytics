/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * lib/ca/ca-zfs.js: ZFS-related facilities
 */

var mod_assert = require('assert');
var mod_child = require('child_process');

var mod_ca = require('./ca-common');

/*
 * Given a command ("zfs" or "zpool") and a list of fields, retrieve the field
 * values from the underlying command and invoke "callback" with the result.
 */
function caZfsData(cmd, infields, callback)
{
	var fields, exec;

	fields = caDeepCopy(infields);
	fields.unshift('name');
	exec = caSprintf('%s list -Hp -o%s', cmd, fields.join(','));
	mod_child.exec(exec, function (error, stdout, stderr) {
		var lines, cols, objects, name, ii, jj;

		if (error)
			return (callback(new caError(ECA_INVAL, error,
			    'failed to invoke "%s" command (stderr: %s)',
			    cmd, stderr)));

		lines = stdout.split('\n');
		objects = {};

		for (ii = 0; ii < lines.length; ii++) {
			if (lines[ii].length === 0)
				continue;

			cols = lines[ii].split('\t');
			mod_assert.equal(fields.length, cols.length);

			name = cols[0];
			mod_assert.ok(!(name in objects),
			    'duplicate dataset or pool name in output');
			objects[name] = {};

			for (jj = 1; jj < cols.length; jj++) {
				mod_assert.ok(!(fields[jj] in objects[name]),
				    'duplicate field name requested');

				if (cols[jj] == '-')
					cols[jj] = 0;

				objects[name][fields[jj]] =
				    parseInt(cols[jj], 10);

				if (isNaN(objects[name][fields[jj]]))
					objects[name][fields[jj]] = cols[jj];
			}
		}

		return (callback(null, objects));
	});
}


/*
 * Manages cache of data retrieved by the zfs(1M) or zpool(1M) commands.
 */
function caZfsDataCache(cmd, datafunc, log)
{
	this.izdm_cmd = cmd;
	this.izdm_columns = {};
	this.izdm_objects = {};
	this.izdm_last = 0;
	this.izdm_refreshing = false;
	this.izdm_callbacks = [];
	this.izdm_stale_timeout = 30 * 1000; /* 30 seconds */
	this.izdm_datafunc = datafunc;
	this.izdm_log = log;
}

/*
 * column(colname, doget): specifies whether to retrieve data for column
 * "colname".  If "doget" is true, retrieve the data.  Otherwise, don't.  This
 * actually acts as a reference count so that multiple consumers can specify
 * overlapping colums and the implementation will only remove a column if all
 * consumers have stopped using it.
 */
caZfsDataCache.prototype.column = function (colname, doget)
{
	if (!(colname in this.izdm_columns)) {
		mod_assert.ok(doget, 'cannot remove column not in use');
		this.izdm_columns[colname] = 0;
		this.izdm_last = 0;
	}

	if (doget)
		this.izdm_columns[colname]++;
	else if (--this.izdm_columns[colname] === 0) {
		this.izdm_last = 0;
		delete (this.izdm_columns[colname]);
	}
};

/*
 * data(callback): retrieve the latest data from this command.  Refreshes the
 * data first if it's deemed too old.
 */
caZfsDataCache.prototype.data = function (callback)
{
	var mgr, now;

	mgr = this;
	now = new Date().getTime();

	/*
	 * If our data is pretty fresh, return it right away.  Otherwise,
	 * piggy-back this request onto the next refresh, and trigger one if
	 * there's not one outstanding.
	 */
	if (now - this.izdm_last < this.izdm_stale_timeout) {
		callback(caDeepCopy(this.izdm_objects));
		return;
	}

	this.izdm_callbacks.push(function (error) {
		if (error)
			return (callback(undefined));

		return (callback(caDeepCopy(mgr.izdm_objects)));
	});

	if (!this.izdm_refreshing)
		this.refresh();
};

/*
 * [private] Trigger a refresh of our data cache by invoking the "zfs" or
 * "zpool" command again.  Invokes each of this.izdm_callbacks() on completion.
 *
 * It is illegal to invoke this command while another refresh() is ongoing.
 * This may seem overly restrictive, but consider the possible semantics of such
 * an operation:
 *
 *	o Invoke another refresh in parallel.  This doesn't make sense.  We
 *	  already cache data to avoid having to make multiple calls to
 *	  "zfs"/"zpool" on the assumption that the underlying data doesn't
 *	  change quickly and the commands themselves are expensive to run.  If a
 *	  second consumer wants data while a previous one is refreshing it, we
 *	  should just serve the first one's data to the second one.
 *
 *	o Invoke another refresh after the previous one completes.  Same problem
 *	  as above regarding wasted effort, except we also have to serialize the
 *	  refreshes.
 *
 *	o Piggy-back this refresh onto the previous one (by saying we'll invoke
 *	  the callback when the outstanding refresh completes).  This is
 *	  reasonable, but could require consumers to deal with some subtle
 *	  races.  For example, a consumer might reasonably want to create a
 *	  dataset, call refresh(), and then ask for data and expect the new
 *	  dataset to be there.  This wouldn't necessarily be the case.
 *
 * We essentially implement (3), but we implement those semantics inside the
 * data() function to keep the semantics of both refresh() and data() pretty
 * simple.
 */
caZfsDataCache.prototype.refresh = function ()
{
	var when, mgr, callbacks;

	mod_assert.ok(!this.izdm_refreshing, 'concurrent refresh is illegal');

	mgr = this;
	when = new Date().getTime();
	callbacks = this.izdm_callbacks;
	this.izdm_callbacks = [];
	this.izdm_refreshing = true;

	this.izdm_datafunc(this.izdm_cmd, Object.keys(this.izdm_columns),
	    function (err, objects) {
		mgr.izdm_refreshing = false;

		if (err) {
			mgr.izdm_log.error('zfs: failed to refresh "%s": %r',
			    mgr.izdm_cmd, err);

			return (callbacks.forEach(function (callback) {
			    callback(err);
			}));
		}

		mgr.izdm_objects = objects;
		mgr.izdm_last = when;
		return (callbacks.forEach(function (callback) { callback(); }));
	});
};


exports.caZfsData = caZfsData;
exports.caZfsDataCache = caZfsDataCache;

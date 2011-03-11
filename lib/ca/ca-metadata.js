/*
 * ca-metadata.js: JSON metadata support
 *
 * The CA system uses declarative JSON metadata to configure pluggable parts of
 * the system like metrics and profiles.  This file provides facilities for
 * loading such metadata and working with it.
 */

var mod_fs = require('fs');
var mod_path = require('path');

var mod_ca = require('./ca-common');
var ASSERT = require('assert').ok;

var cmd_log;

/*
 * The metadata manager implements our interface to the rest of the world,
 * allowing consumers to load metadata from disk and then retrieve the loaded
 * copies.
 */
function caMetadataManager(log, directory, depth)
{
	cmd_log = log;
	this.cmm_depth = depth || 3;
	this.cmm_metadata = {};
	this.cmm_directory = directory;
}

caMetadataManager.prototype.get = function (type, instance)
{
	return (caDeepCopy(this.cmm_metadata[type][instance]));
};

caMetadataManager.prototype.list = function (type)
{
	return (Object.keys(this.cmm_metadata[type]));
};

caMetadataManager.prototype.listTypes = function ()
{
	return (Object.keys(this.cmm_metadata));
};

caMetadataManager.prototype.load = function (callback)
{
	var mgr = this;

	caMetadataLoadPath(this.cmm_directory, this.cmm_depth,
	    function (err, metadata) {
		mgr.cmm_metadata = metadata || {};
		return (callback(err));
	});
};

/*
 * Given a single metadata file, load it and invoke callback when finished.
 */
function caMetadataLoadFile(filename, callback)
{
	mod_fs.readFile(filename, 'utf-8', function (err, contents) {
		var json;

		if (err)
			return (callback(new caError(ECA_INVAL, err,
			    'failed to read metadata file "%s"', filename)));

		try {
			json = JSON.parse(contents);
		} catch (ex) {
			return (callback(new caError(ECA_INVAL, ex,
			    'failed to parse metadata file "%s"', filename)));
		}

		cmd_log.dbg('loaded metadata file "%s"', filename);
		return (callback(null, json));
	});
}

/*
 * Given the path to a regular file, this function is equivalent to
 * caMetadataLoadFile.  Given the path to a directory, this function recursively
 * loads the metadata contained therein.  The result is an object whose keys are
 * directory entries in the specified directory and whose values are the result
 * of invoking this function recursively on the resulting entry.  maxdepth is
 * used to limit recursion; an error is returned if this value is exceeded.
 */
function caMetadataLoadPath(path, maxdepth, callback)
{
	if (maxdepth === 0)
		return (callback(new caError(ECA_INVAL, null,
		    'exceeded maximum depth while loading metadata')));

	return (mod_fs.stat(path, function (err, st) {
		if (err)
			return (callback(new caError(ECA_INVAL, err,
			    'failed to stat "%s"', path)));

		if (!st.isDirectory()) {
			if (!caEndsWith(path, '.json')) {
				cmd_log.warn('skipping metadata file "%s"',
				    path);
				return (callback(null, undefined));
			}

			return (caMetadataLoadFile(path, callback));
		}

		return (caMetadataLoadDirectory(path, maxdepth, callback));
	}));
}

function caMetadataLoadDirectory(path, maxdepth, callback)
{
	mod_fs.readdir(path, function (err, files) {
		var callbacks, types;

		if (err)
			return (callback(new caError(ECA_INVAL, err,
			    'failed to readdir "%s"', path)));

		callbacks = files.map(function (childpath) {
			return (function (complete) {
				caMetadataLoadPath(
				    mod_path.join(path, childpath),
				    maxdepth - 1, complete);
			});
		});
		types = files.map(function (childpath) {
			if (!caEndsWith(childpath, '.json'))
				return (childpath);
			return (childpath.substring(0,
			    childpath.length - '.json'.length));
		});

		return (caRunParallel(callbacks, function (rv) {
			var ii, error, result;

			ASSERT(rv.nerrors > 0 ||
			    rv.results.length == types.length);
			result = {};
			for (ii = 0; ii < rv.results.length; ii++) {
				if (rv.results[ii].result)
					result[types[ii]] =
					    rv.results[ii].result;
			}

			if (rv.nerrors > 0)
				error = new caError(
				    rv.results[rv.errlocs[0]].error.code(),
				    rv.results[rv.errlocs[0]].error,
				    'failed to load metadata types ' +
				    '(first of %d errors)', rv.nerrors);


			return (callback(error, result));
		}));
	});
}

/*
 * The only interface to the outside world is caMetadataManager.  The other
 * functions are exported for testing only.
 */
exports.caMetadataManager = caMetadataManager;
exports.caMetadataLoadFile = caMetadataLoadFile;
exports.caMetadataLoadDirectory = caMetadataLoadDirectory;
exports.caMetadataLoadPath = caMetadataLoadPath;

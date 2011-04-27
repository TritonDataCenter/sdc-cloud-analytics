/*
 * ca-persist.js: facilities for data persistence
 *
 * A "stash" is a collection of named buckets containing data.  This is the main
 * abstraction exposed by the persistence service to the rest of CA.  caStash
 * implements a stash, including routines to save and load it from disk.
 */

var mod_assert = require('assert');
var mod_fs = require('fs');
var mod_path = require('path');

var mod_ca = require ('./ca-common');

var ASSERT = mod_assert.ok;

/*
 * The stash version covers the directory layout and metadata formats.  The
 * bucket version covers the format of each individual bucket data file.  For
 * examples:
 *
 *    o If we wanted to change the data format in the future to use msgpack
 *      instead of JSON, we would rev ca_bucket_version_major, since old
 *      software should not attempt to read the new file.
 *
 *    o If we wanted to change the metadata files to use msgpack instead of
 *      JSON, we'd rev ca_stash_version_major, since old software should not
 *      even attempt to read any of the metadata files.
 * 
 *    o If we wanted to change the metadata format in the future to provide an
 *      optional "format" member that specified what format the actual data was
 *      stored in, we would probably rev ca_stash_version_minor, since old
 *      software could still read new metadata files, but we would probably also
 *      rev ca_bucket_version_major to indicate that the data should not be read
 *      by older software.
 */
var ca_stash_version_major = 1;		/* stash format major version */
var ca_stash_version_minor = 0;		/* stash format minor version */
var ca_bucket_version_major = 1;	/* bucket format major version */
var ca_bucket_version_minor = 0;	/* bucket format minor version */

/*
 * See the block comment at the top of this file.  This implementation of a
 * stash stores data in a filesystem tree as follows:
 *
 *    $stash_root/
 *        stash.json		Global stash metadata (version)
 *        bucket-XX/		Directory for bucket XX
 *            metadata.json	Metadata for bucket XX (version)
 *            data		Data for bucket XX
 *        ...			More buckets
 */
function caStash(log)
{
	this.cas_log = log;
}

/*
 * Loads the contents of stash from disk.  If this stash does not exist on disk,
 * this operation will create it.  This operation must be completed before the
 * stash can be used.
 */
caStash.prototype.init = function (directory, callback)
{
	var stash, stages;

	ASSERT(!this.cas_buckets, 'caStash already initialized');
	ASSERT(!this.cas_rootdir, 'caStash already initializing');

	stash = this;
	this.cas_rootdir = directory;
	this.cas_log.info('loading stash from "%s"', directory);

	stages = [
		this.loadInit.bind(this),
		this.loadBuckets.bind(this),
		this.loadFini.bind(this)
	];

	caRunStages(stages, null, function (err, result) {
		if (err)
			stash.cas_rootdir = undefined;
		return (callback(err));
	});
};

/*
 * [private] Try to load stash metadata.  If it doesn't exist, assume we need to
 * create the stash from scratch.
 */
caStash.prototype.loadInit = function (unused, callback)
{
	var stash, path;

	stash = this;
	path = mod_path.join(this.cas_rootdir, 'stash.json');
	caReadFileJson(path, function (err, json) {
		if (err) {
			if (err.code() == ECA_NOENT)
				return (stash.populate(callback));

			return (callback(new caError(err.code(), err,
			    'failed to load stash metadata')));
		}

		if (json.ca_stash_version_major != ca_stash_version_major)
			return (callback(new caError(ECA_INVAL, null,
			    'failed to load stash: major version conflict ' +
			    '(expected %s but got %s)', ca_stash_version_major,
			    json.ca_stash_version_major)));

		stash.cas_stash_metadata = json;
		callback();
	});
};

/*
 * [private] Load all of the individual stash buckets' metadata.
 */
caStash.prototype.loadBuckets = function (unused, callback)
{
	var stash = this;

	mod_fs.readdir(this.cas_rootdir, function (err, files) {
		var ii, tasks;

		if (err)
			return (callback(new caSystemError(err,
			    'failed to read stash')));

		tasks = [];

		for (ii = 0; ii < files.length; ii++) {
			if (files[ii] == 'stash.json')
				continue;

			if (!caStartsWith(files[ii], 'bucket-')) {
				log.warn('stash: skipping non-bucket "%s"',
				    files[ii]);
				continue;
			}

			tasks.push(stash.loadBucket.bind(stash, files[ii]));
		}

		caRunParallel(tasks, function (rv) { callback(null, rv); });
	});
};

/*
 * [private] Load a particular stash bucket's metadata.
 */
caStash.prototype.loadBucket = function (bucket, callback)
{
	var path;

	path = mod_path.join(this.cas_rootdir, bucket, 'metadata.json');
	caReadFileJson(path, function (err, json) {
		if (err)
			return (callback(new caSystemError(err,
			    'failed to read stash bucket "%s"', bucket)));

		if (json.ca_bucket_version_major > ca_bucket_version_major)
			return (callback(new caError(ECA_INVAL, null,
			    'failed to load stash bucket "%s": major version ' +
			    'conflict (expected %s but got %s)', bucket,
			    ca_bucket_version_major,
			    json.ca_bucket_version_major)));

		return (callback(null, { bucket: bucket, metadata: json }));
	});
}

/*
 * [private] Finish loading bucket metadata.
 */
caStash.prototype.loadFini = function (rv, callback)
{
	var fatal, err, result, ii;

	fatal = [];
	for (ii = 0; ii < rv['errlocs'].length; ii++) {
		err = rv['results'][rv['errlocs'][ii]]['error'];

		/*
		 * If the metadata file doesn't exist, just skip this bucket.
		 * Pretend it never existed.  XXX remove the directory?
		 */
		if (err.code() == ECA_NOENT) {
			this.cas_log.warn('%s', err);
			continue;
		}

		/*
		 * If we fail to read it for some other reason (e.g.,
		 * insufficient privileges, invalid JSON, or I/O error), we
		 * consider that a fatal error.  This will probably require
		 * operator intervention to clear.
		 */
		this.cas_log.error('%s', err);
		fatal.push(err);
	}

	if (fatal.length > 0) {
		this.cas_log.error('failed to initialize stash ' +
		    '(%d errors)', fatal.length);
		return (callback(new caError(fatal[0].code(), fatal[0],
		    'failed to initialize stash (first of %d errors)',
		    fatal.length)));
	}

	this.cas_buckets = {};
	for (ii = 0; ii < rv['results'].length; ii++) {
		result = rv['results'][ii]['result'];
		this.cas_buckets[result['bucket']] = result['metadata'];
	}

	return (callback());
};

/*
 * [private] Create the on-disk representation of an empty stash.
 */
caStash.prototype.populate = function (callback)
{
	var stash, path, tmppath, stages;
	var mkdir, mkfile, mvfile;

	mkdir = function (unused, subcallback) {
		mod_fs.mkdir(stash.cas_rootdir, 0700, function (err) {
			if (err)
				return (subcallback(new caSystemError(err,
				    'failed to create new stash')));

			return (subcallback());
		});
	}

	mkfile = function (unused, subcallback) {
		mod_fs.writeFile(tmppath, JSON.stringify(config), 'utf-8',
		    function (err) {
			if (err)
				return (subcallback(new caSystemError(err,
				    'failed to write new stash config')));

			return (subcallback());
		    });
	}

	mvfile = function (unused, subcallback) {
		mod_fs.rename(tmppath, path, function (err) {
			if (err)
				return (subcallback(new caSystemError(err,
				    'failed to save new stash config')));

			return (subcallback());
		});
	};

	stash = this;
	path = mod_path.join(this.cas_rootdir, 'stash.json');
	tmppath = path + '.tmp';
	stages = [ mkdir, mkfile, mvfile ]; /* XXX fsync! */
	caRunStages(stages, null, callback);
};

/*
 * Saves "contents" and "metadata" into the bucket called "name".  This
 * operation always replaces all of "metadata" and "contents" for this bucket
 * and it does so atomically.
 */
caStash.prototype.bucketFill = function (bucket, metadata, contents, callback)
{
	ASSERT(this.cas_buckets, 'caStash.bucketFill() called before init()');
	/*
	 * XXX here we write the metadata and data to disk.  In order for this
	 * to be atomic, we must do the following:
	 *    o remove newbucket-... if it exists
	 *	(XXX synchronize on other requests -- or else use random name)
 	 *    o create a new bucket directory that starts with "newbucket-"
	 *    o fill in the two files, and fsync() them
	 *    o if "bucket-..." exists, rename it to "oldbucket-..."
	 *    o rename "newbucket-..." to "bucket-..."
	 *    o return to caller
	 *
	 * and then modify init() to rename "oldbucket-..." to the new thing if
	 * it finds one.  it MUST remove oldbucket-... if that fails with
	 * EEXIST.  Otherwise deleting a bucket and then reloading the stash
	 * could cause old data to reappear.
	 */
};

/*
 * Retrieves the metadata for the named bucket.
 */
caStash.prototype.bucketMetadata = function (bucket)
{
	ASSERT(this.cas_buckets, 'caStash.bucketFill() called before init()');
	return (this.cas_buckets[bucket]);
};

/*
 * Retrieves the contents of the named bucket as a string.
 */
caStash.prototype.bucketData = function (bucket, callback)
{
	var ret, path;

	ASSERT(this.cas_buckets, 'caStash.bucketFill() called before init()');

	if (!(bucket in this.cas_buckets)) {
		setTimeout(callback.bind(null, new caError(ECA_ENOENT)), 0);
		return;
	}

	path = mod_path.join(this.cas_rootdir, 'bucket-' + bucket, 'data.json');
	mod_fs.readFile(path, function (err, data) {
		if (err)
			return (callback(new caSystemError(err,
			    'failed to read data for bucket "%s"' bucket)));

		callback(null, data);
	});
};

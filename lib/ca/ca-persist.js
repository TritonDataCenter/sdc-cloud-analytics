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

var mod_ca = require('./ca-common');
var mod_catask = require('./ca-task');

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
function caStash(log, sysinfo)
{
	this.cas_log = log;
	this.cas_creator = caDeepCopy(sysinfo);
	this.cas_busy = {};
	this.cas_cleanup = [];
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

	caRunStages(stages, null, function (err) {
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
			if (err.code() == ECA_NOENT) {
				return (stash.populate(function (err2) {
					if (err2)
						return (callback(err2));

					return (stash.loadInit(null, callback));
				}));
			}

			return (callback(new caError(err.code(), err,
			    'failed to load stash metadata')));
		}

		if (json.ca_stash_version_major != ca_stash_version_major)
			return (callback(new caError(ECA_INVAL, null,
			    'failed to load stash: major version conflict ' +
			    '(expected %s but got %s)', ca_stash_version_major,
			    json.ca_stash_version_major)));

		stash.cas_stash_metadata = json;
		return (callback());
	});
};

/*
 * [private] Load all of the individual stash buckets' metadata.
 */
caStash.prototype.loadBuckets = function (unused, callback)
{
	var stash, log;

	function cleanupRemove(bucket) {
		return (function (unused2, subcallback) {
			var path;

			path = mod_path.join(stash.cas_rootdir, bucket);
			log.warn('stash: removing stale path "%s"', path);
			caRemoveTree(log, path, subcallback);
		});
	}

	function cleanupPromote(bucket) {
		var basename, oldpath, newpath;

		/* Chop off "old" and the trailing random characters. */
		basename = bucket.substring(3, bucket.lastIndexOf('-'));
		oldpath = mod_path.join(stash.cas_rootdir, bucket);
		newpath = mod_path.join(stash.cas_rootdir, basename);

		return (function (unused2, subcallback) {
			log.warn('stash: attempting to promote "%s"', oldpath);
			caRename(oldpath, newpath, function (err) {
				if (!err || err.code() != ECA_EXISTS)
					return (subcallback(err));

				/*
				 * The new bucket already exists.  Remove this
				 * old one.
				 */
				log.warn('stash: promotion of "%s" failed ' +
				    'because the destination exists; ' +
				    'removing old copy', oldpath);
				return (caRemoveTree(log, oldpath,
				    subcallback));
			});
		});
	}

	stash = this;
	log = stash.cas_log;
	mod_fs.readdir(this.cas_rootdir, function (err, files) {
		var ii, tasks;

		if (err)
			return (callback(new caSystemError(err,
			    'failed to read stash')));

		tasks = [];

		for (ii = 0; ii < files.length; ii++) {
			if (files[ii] == 'stash.json')
				continue;

			if (caStartsWith(files[ii], 'newbucket-')) {
				log.warn('stash: found "%s", will remove',
				    files[ii]);
				stash.cas_cleanup.push(
				    cleanupRemove(files[ii]));
				continue;
			}

			if (caStartsWith(files[ii], 'oldbucket-')) {
				log.warn('stash: found "%s", will attempt ' +
				    'to promote');
				stash.cas_cleanup.push(
				    cleanupPromote(files[ii]));
				continue;
			}

			if (!caStartsWith(files[ii], 'bucket-')) {
				log.warn('stash: skipping non-bucket "%s"',
				    files[ii]);
				continue;
			}

			tasks.push(stash.loadBucket.bind(stash, files[ii]));
		}

		return (caRunParallel(tasks,
		    function (rv) { callback(null, rv); }));
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

		bucket = bucket.substring('bucket-'.length);

		return (callback(null, { bucket: bucket, metadata: json }));
	});
};

/*
 * [private] Finish loading bucket metadata.
 */
caStash.prototype.loadFini = function (rv, callback)
{
	var fatal, err, result, ii, cleanup;

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

	cleanup = this.cas_cleanup;
	delete (this.cas_cleanup);

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

	return (caRunStages(cleanup, null, function (suberr) {
		if (suberr)
			suberr = new caError(suberr.code(), suberr,
			    'failed to clean up stash');
		callback(suberr);
	}));
};

/*
 * [private] Create the on-disk representation of an empty stash.
 */
caStash.prototype.populate = function (callback)
{
	var stash, path, tmppath, stages, config;
	var mkdir, mkfile, mvfile;

	this.cas_log.info('creating new stash at "%s"', this.cas_rootdir);

	mkdir = function (unused, subcallback) {
		mod_fs.mkdir(stash.cas_rootdir, 0700, function (err) {
			if (err)
				return (subcallback(new caSystemError(err,
				    'failed to create new stash')));

			return (subcallback());
		});
	};

	mkfile = function (unused, subcallback) {
		caSaveFile(tmppath, JSON.stringify(config), function (err) {
			if (err)
				return (subcallback(new caSystemError(err,
				    'failed to write new stash config')));

			return (subcallback());
		});
	};

	mvfile = function (unused, subcallback) {
		caRename(tmppath, path, function (err) {
			if (err)
				return (subcallback(new caSystemError(err,
				    'failed to save new stash config')));

			return (subcallback());
		});
	};

	stash = this;
	path = mod_path.join(this.cas_rootdir, 'stash.json');
	tmppath = path + '.tmp';
	config = {
	    ca_stash_version_major: ca_stash_version_major,
	    ca_stash_version_minor: ca_stash_version_minor,
	    ca_stash_created: new Date(),
	    ca_stash_creator: this.cas_creator
	};
	stages = [ mkdir, mkfile, mvfile ];
	caRunStages(stages, null, callback);
};

caStash.prototype.created = function ()
{
	ASSERT(this.cas_buckets, 'caStash.created() called before init()');
	return (new Date(this.cas_stash_metadata.ca_stash_created));
};

/* [private] */
caStash.prototype.bucketTask = function (bucket, callback)
{
	if (!(bucket in this.cas_busy))
		this.cas_busy[bucket] = new mod_catask.caTaskSerializer();

	this.cas_busy[bucket].task(function (taskcb) { callback(taskcb); });
};

/*
 * Saves "contents" and "metadata" into the bucket called "name".  This
 * operation always replaces all of "metadata" and "contents" for this bucket
 * and it does so atomically.
 */
caStash.prototype.bucketFill = function (bucket, metadata, contents, callback)
{
	var stash = this;

	ASSERT(this.cas_buckets, 'caStash.bucketFill() called before init()');

	this.bucketTask(bucket, function (taskcb) {
		stash.doBucketFill(bucket, metadata, contents, function (err) {
			callback(err, err ? undefined : true);
			taskcb();
		});
	});
};

/*
 * Retrieves the metadata for the named bucket.
 */
caStash.prototype.bucketMetadata = function (bucket)
{
	/*
	 * This operation is not synchronized with read/write because only one
	 * "write" will be happening at a time and it will atomically update
	 * this metadata when it commits.
	 */
	ASSERT(this.cas_buckets, 'caStash.bucketFill() called before init()');

	if (!(bucket in this.cas_buckets))
		return (undefined);

	return (this.cas_buckets[bucket].ca_bucket_umetadata);
};

/*
 * Retrieves the contents of the named bucket as an object with "metadata" and
 * "data" members.
 */
caStash.prototype.bucketContents = function (bucket, callback)
{
	var stash = this;

	ASSERT(this.cas_buckets, 'caStash.bucketFill() called before init()');

	this.bucketTask(bucket, function (taskcb) {
		stash.doBucketContents(bucket, function (err, result) {
			callback(err, result);
			taskcb();
		});
	});
};

caStash.prototype.doBucketFill = function (bucket, umetadata, contents,
    callback)
{
	var stash, metadata, stages, rand, written, log;
	var tmpdir, realdir, olddir, mdfile, datafile;

	/*
	 * XXX if contents is empty, just rename and wipe out the directory.
	 * Make sure that any oldbucket-... one is removed too!
	 * XXX does that really make sense given that we have metadata?
	 */
	if (typeof (bucket) != typeof (''))
		return (callback(new caError(ECA_INVAL, null,
		    'bucket name must be a string')));

	if (typeof (umetadata) != typeof ({}) ||
	    umetadata.constructor !== Object)
		return (callback(new caError(ECA_INVAL, null,
		    'metadata must be an object')));

	if (bucket.length > 0 && bucket[0] == '.')
		return (callback(new caError(ECA_INVAL, null,
		    'bucket "%s" is reserved and cannot be written', bucket)));

	/*
	 * Because we use a per-bucket task serializer around all read and write
	 * operations, we know that nobody else is currently reading or writing
	 * this bucket's directory or related files.  We still need to worry
	 * about atomicity in case we crash, so we use the following procedure
	 * to write out the new bucket:
	 *
	 *    (1) Create directory "newbucket-<bucket name>-<random>" to contain
	 *        the new metadata and data files.  The random bit in the name
	 *        allows this procedure to work in the face of concurrent
	 *        changes to the same bucket.
	 *
	 *    (2) Write out the metadata and data files into this new directory,
	 *        using caSaveFile to make sure they're completely fsyncked
	 *        before proceeding.
	 *
	 *    (3) If "bucket-<bucket name>" exists, rename it to
	 *        "oldbucket-<bucket name>-<random>".  Again, the random piece
	 *        here allows us to support multiple concurrent changes.  We use
	 *        caRename to ensure that the directory has been updated on
	 *        disk.  To avoid a race, we always try this operation and
	 *        simply ignore any ENOENT error.
	 *
	 *    (4) Rename the temporary bucket to "bucket-<bucket name>".
	 *
	 *    (5) Remove "oldbucket-<bucket name>-<random>".
	 *
	 * Note that if we find newbucket-* during initialization, then we
	 * remove it.  If we find oldbucket-X and no bucket-X, then we rename
	 * oldbucket-X to bucket-X.  Otherwise we remove oldbucket-X.  See
	 * init() for details.
	 */
	stash = this;
	metadata = {
	    ca_bucket_version_major: ca_bucket_version_major,
	    ca_bucket_version_minor: ca_bucket_version_minor,
	    ca_bucket_umetadata: umetadata
	};
	stages = [];
	written = false;
	log = this.cas_log;
	rand = Math.floor(Math.random() * 10000);
	realdir = mod_path.join(this.cas_rootdir,
	    caSprintf('bucket-%s', bucket));
	olddir = mod_path.join(this.cas_rootdir,
	    caSprintf('oldbucket-%s-%s', bucket, rand));
	tmpdir = mod_path.join(this.cas_rootdir,
	    caSprintf('newbucket-%s-%s', bucket, rand));
	mdfile = mod_path.join(tmpdir, 'metadata.json');
	datafile = mod_path.join(tmpdir, 'data.json');

	stages.push(function (unused, subcallback) {
		log.dbg('stash update "%s": mkdir "%s"', bucket, tmpdir);
		mod_fs.mkdir(tmpdir, 0700, subcallback);
	});

	stages.push(function (unused, subcallback) {
		log.dbg('stash update "%s": saving "%s"', bucket, mdfile);
		caSaveFile(mdfile, JSON.stringify(metadata), subcallback);
	});

	stages.push(function (unused, subcallback) {
		log.dbg('stash update "%s": saving "%s"', bucket, datafile);
		caSaveFile(datafile, contents, subcallback);
	});

	stages.push(function (unused, subcallback) {
		written = true;

		log.dbg('stash update "%s": rename "%s" to "%s"',
		    bucket, realdir, olddir);

		caRename(realdir, olddir, function (err) {
			/* It's fine if the bucket didn't exist before. */
			if (err && err.code() == ECA_NOENT) {
				log.dbg('stash update "%s": "%s" didn\'t exist',
				    bucket, olddir);
				err = undefined;
			}

			return (subcallback(err));
		});
	});

	stages.push(function (unused, subcallback) {
		log.dbg('stash update "%s": rename "%s" to "%s"',
		    bucket, tmpdir, realdir);
		caRename(tmpdir, realdir, subcallback);
	});

	stages.push(function (unused, subcallback) {
		log.dbg('stash update "%s": removing "%s"', bucket, olddir);

		caRemoveTree(log, olddir, function (err) {
			if (err) {
				/*
				 * At this point we've already moved the new
				 * directory into place, so the operation is
				 * essentially committed.  The impact of leaving
				 * this turd around is that if someone deletes
				 * the bucket, the old data will be picked up
				 * again next time we start up.  There's nothing
				 * we can reasonably do to avoid this here but
				 * we can catch this when we remove the bucket.
				 */
				log.warn('failed to remove directory "%s": %r',
				    olddir, err);
			}

			return (subcallback());
		});
	});

	return (caRunStages(stages, null, function (err) {
		if (!err) {
			log.info('stash update "%s" completed', bucket);
			stash.cas_buckets[bucket] = caDeepCopy(metadata);
			return (callback(null));
		}

		/*
		 * Try to unwind our state.  If we didn't even finish writing
		 * out the new bucket, just try to remove it.  If this fails,
		 * it just leaves a turd that nothing will ever touch again.
		 */
		log.error('stash update "%s" failed: %r', bucket, err);

		if (!written) {
			log.dbg('stash update "%s" failed; removing "%s"',
			    bucket, tmpdir);
			caRemoveTree(log, tmpdir,
			    function () { callback(err); });
			return (undefined);
		}

		/*
		 * We successfully wrote out the bucket but failed to rename it
		 * into place.  This can only happen under very exceptional
		 * conditions under which we can't proceed without sacrificing
		 * consistency.
		 */
		caPanic('failed to update stash after writing new bucket ("' +
		    bucket + '")', err);
		return (undefined);
	}));
};

caStash.prototype.doBucketContents = function (bucket, callback)
{
	var key, cts, stash, log, path;

	if (bucket == '.contents') {
		cts = {};
		for (key in this.cas_buckets)
			cts[key] = this.cas_buckets[key].ca_bucket_umetadata;

		return (callback(null, {
		    bucket: bucket,
		    metadata: JSON.stringify(this.cas_stash_metadata),
		    data: JSON.stringify(cts)
		}));
	}

	if (!(bucket in this.cas_buckets))
		return (callback(new caError(ECA_NOENT)));

	stash = this;
	log = this.cas_log;
	path = mod_path.join(this.cas_rootdir, 'bucket-' + bucket, 'data.json');

	log.dbg('reading contents of bucket "%s"', bucket);

	return (mod_fs.readFile(path, function (err, data) {
		if (err) {
			err = new caSystemError(err,
			    'failed to read data for bucket "%s"', bucket);
			log.warn('stash read failed: %r', err);
			return (callback(err));
		}

		log.dbg('stash read of "%s" completed (%d bytes)', bucket,
		    data.length);

		return (callback(null, {
		    bucket: bucket,
		    metadata: stash.bucketMetadata(bucket),
		    data: data.toString('utf-8')
		}));
	}));
};

/*
 * Recursively remove the given path.
 */
function caRemoveTree(log, path, callback)
{
	mod_fs.lstat(path, function (err, stat) {
		if (err) {
			if (err.code == 'ENOENT')
				return (callback());

			return (callback(new caSystemError(err)));
		}

		if (stat.isDirectory())
			return (caRemoveDirectory(log, path, callback));

		return (caRemoveFile(log, path, callback));
	});
}

function caRemoveFile(log, path, callback)
{
	log.dbg('unlink "%s"', path);
	mod_fs.unlink(path, callback);
}

function caRemoveDirectory(log, path, callback)
{
	mod_fs.readdir(path, function (err, files) {
		if (err)
			return (callback(err));

		return (caRunParallel(files.map(function (filename) {
			var subpath = mod_path.join(path, filename);
			return (caRemoveTree.bind(null, log, subpath));
		}), function (rv) {
			var errors;

			if (rv['nerrors'] === 0) {
				log.dbg('rmdir "%s"', path);
				return (mod_fs.rmdir(path, callback));
			}

			errors = rv['errlocs'].map(function (ii) {
				return (rv['results'][ii]['error']);
			});

			return (new caError(errors[0].code(), errors[0],
			    'failed to remove dir "%s": first error follows',
			    path));
		}));
	});
}

/*
 * Writes the specified data to the named file.  The callback will be invoked
 * only after the data has been syncked to disk.
 */
function caSaveFile(filename, data, callback)
{
	var open, write, sync;
	var fd, nwritten;

	open = function (unused, subcallback) {
		mod_fs.open(filename, 'w', 0666, subcallback);
	};

	write = function (ofd, subcallback) {
		fd = ofd;
		mod_fs.write(fd, data, nwritten, data.length - nwritten, null,
		    function (err, nbytes) {
			if (err)
				return (subcallback(err));

			nwritten += nbytes;
			if (nwritten < data.length)
				return (write(fd, subcallback));

			return (subcallback(null, fd));
		    });
	};

	sync = mod_fs.fsync;

	nwritten = 0;
	data = new Buffer(data, 'utf-8');
	caRunStages([ open, write, sync ], null, function (err, result) {
		if (fd === undefined)
			return (callback(new caSystemError(err,
			    'failed to open file "%s"', filename)));

		return (mod_fs.close(fd, function () {
			/* We ignore any error from close. */
			if (err)
				err = new caSystemError(err,
				    'failed to write or sync file "%s"',
				    filename);
			return (callback(err));
		}));
	});
}

/*
 * Reads the named file and parses it as JSON.
 */
function caReadFileJson(filename, callback)
{
	mod_fs.readFile(filename, 'utf-8', function (err, contents) {
		var json;

		if (err)
			return (callback(new caSystemError(err,
			    'failed to read file "%s"', filename)));

		try {
			json = JSON.parse(contents);
		} catch (ex) {
			return (callback(new caError(ECA_INVAL, ex,
			    'failed to JSON file "%s"', filename)));
		}

		return (callback(null, json));
	});
}

/*
 * Like POSIX rename() (or mod_fs.rename()), but waits until the changes are
 * flushed to stable storage.
 */
function caRename(src, dst, callback)
{
	var dstdir, stages, rfd, renamed;

	/*
	 * We use mod_fs.rename() and then fsync() to flush the outstanding
	 * changes to stable storage.  fsyncking either the source or
	 * destination directory should be sufficient since the rename() itself
	 * is guaranteed to be atomic.  We choose the destination.  We normalize
	 * "dst" before computing dirname because mod_path.dirname() doesn't
	 * properly deal with multiple trailing slashes.
	 */
	dstdir = mod_path.dirname(mod_path.normalize(dst));
	stages = [];

	stages.push(function (unused, subcallback) {
		mod_fs.rename(src, dst, subcallback);
	});

	stages.push(function (unused, subcallback) {
		renamed = true;
		mod_fs.open(dstdir, 'r', 0777, subcallback);
	});

	stages.push(function (fd, subcallback) {
		rfd = fd;
		mod_fs.fsync(fd, subcallback);
	});

	caRunStages(stages, null, function (err, result) {
		if (!renamed)
			return (callback(new caSystemError(err,
			    'failed to rename "%s" to "%s"', src, dst)));

		if (rfd === undefined)
			return (callback(new caSystemError(err,
			    'failed to open directory "%s" for sync', dstdir)));

		if (err)
			err = new caSystemError(err,
			    'failed to sync directory "%s"', dstdir);

		/* We ignore any error from close. */
		return (mod_fs.close(rfd,
		    function () { return (callback(err)); }));
	});
}

exports.caReadFileJson = caReadFileJson;
exports.caSaveFile = caSaveFile;
exports.caRename = caRename;
exports.caRemoveTree = caRemoveTree;
exports.caRemoveFile = caRemoveFile;
exports.caRemoveDirectory = caRemoveDirectory;
exports.caStash = caStash;

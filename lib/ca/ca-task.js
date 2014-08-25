/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * ca-task.js: Task Serializer interface
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

function caTaskSerializer()
{
	this.cts_pending = null;
	this.cts_waiters = [];
}

caTaskSerializer.prototype.task = function (callback)
{
	this.cts_waiters.push(callback);
	this.start();
};

/* [private] */
caTaskSerializer.prototype.start = function ()
{
	var serializer, func;

	if (this.cts_pending !== null || this.cts_waiters.length === 0)
		return;

	serializer = this;
	func = this.cts_waiters.shift();
	this.cts_pending = func;
	this.cts_pending(function () {
		ASSERT(serializer.cts_pending == func);
		serializer.cts_pending = null;
		serializer.start();
	});
};

exports.caTaskSerializer = caTaskSerializer;

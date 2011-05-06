/*
 * tst.serializer.js: tests task serializer
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common.js');
var mod_task = require('../../lib/ca/ca-task.js');
var mod_tl = require('../../lib/tst/ca-test.js');

var taskq, taskcb, count;

mod_tl.ctSetTimeout(5 * 1000);
taskq = new mod_task.caTaskSerializer();
count = 0;

function dotask(callback)
{
	console.log('task start');
	mod_assert.ok(!taskcb);
	taskcb = callback;
	setTimeout(donetask, 100);
	count++;
}

function donetask()
{
	var func;

	console.log('task done');
	mod_assert.ok(taskcb);
	func = taskcb;
	taskcb = undefined;
	func();
}

taskq.task(dotask);
taskq.task(dotask);
taskq.task(dotask);
taskq.task(dotask);
taskq.task(dotask);
taskq.task(function () {
	mod_assert.ok(!taskcb);
	mod_assert.equal(count, 5);
	console.log('all tasks completed');
	process.exit(0);
});

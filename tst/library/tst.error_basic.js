/*
 * tst.error_basic.js: test caError class basic fields
 */

var mod_assert = require('assert');

var mod_ca = require('../../lib/ca/ca-common.js');

console.log('simple error');
var exn = new caError(ECA_INVAL, null, 'test string for an error');
mod_assert.equal(ECA_INVAL, exn.code());
mod_assert.equal(undefined, exn.cause());
mod_assert.equal('test string for an error', exn.message);
mod_assert.equal('test string for an error', exn.toString());

console.log('nested errors');
var exn2 = new caError(ECA_REMOTE, exn, 'a higher-level error');
mod_assert.equal(ECA_REMOTE, exn2.code());
mod_assert.equal(exn, exn2.cause());
mod_assert.equal('a higher-level error', exn2.message);
mod_assert.equal('a higher-level error: test string for an error',
    exn2.toString());

console.log('default messages');
exn = new caError(ECA_REMOTE);
mod_assert.equal(ECA_REMOTE, exn.code());
mod_assert.equal(undefined, exn.cause());
mod_assert.equal('remote service failure', exn.message);
mod_assert.equal('remote service failure', exn.toString());

console.log('validation errors');
exn = new caValidationError('this field is invalid');
mod_assert.equal(ECA_INVAL, exn.code());
mod_assert.equal(undefined, exn.cause());
mod_assert.equal('this field is invalid', exn.message);
mod_assert.equal('this field is invalid', exn.toString());

console.log('invalid field error: missing value');
exn = new caInvalidFieldError('myfield');
mod_assert.equal(ECA_INVAL, exn.code());
mod_assert.equal(undefined, exn.cause());
mod_assert.equal('missing value for required field: "myfield"', exn.message);
mod_assert.equal('missing value for required field: "myfield"', exn.toString());
mod_assert.equal(exn.field(), 'myfield');
mod_assert.equal(exn.value(), undefined);
mod_assert.equal(exn.reason(), 'missing');

console.log('invalid field error: invalid value');
exn = new caInvalidFieldError('cpuid', 'net0');
mod_assert.equal(ECA_INVAL, exn.code());
mod_assert.equal(undefined, exn.cause());
mod_assert.equal('value "net0" for field "cpuid" is invalid: illegal value',
    exn.message);
mod_assert.equal('value "net0" for field "cpuid" is invalid: illegal value',
    exn.toString());
mod_assert.equal(exn.field(), 'cpuid');
mod_assert.equal(exn.value(), 'net0');
mod_assert.equal(exn.reason(), 'illegal value');

console.log('invalid field error: other reason');
exn = new caInvalidFieldError('cpuid', 'net0', 'over the line');
mod_assert.equal(ECA_INVAL, exn.code());
mod_assert.equal(undefined, exn.cause());
mod_assert.equal('value "net0" for field "cpuid" is invalid: over the line',
    exn.message);
mod_assert.equal('value "net0" for field "cpuid" is invalid: over the line',
    exn.toString());
mod_assert.equal(exn.field(), 'cpuid');
mod_assert.equal(exn.value(), 'net0');
mod_assert.equal(exn.reason(), 'over the line');

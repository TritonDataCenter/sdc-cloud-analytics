/*
 * ca-amqp: AMQP shim (and related facilities) for distributed system
 */

var mod_sys = require('sys');
var mod_events = require('events');
var mod_amqp = require('amqp');

/*
 * Manages a connection to an AMQP broker in a distributed system with the
 * following properties:
 *
 *	o Exactly one global exchange is in use.
 *
 *	o Each component has a unique identifier ("hostname") within the system.
 *
 *	o Each component has a unique routing key within the system that
 *	  includes at least the hostname but may include additional pieces like
 *	  its type.
 *
 *	o Each component has exactly one queue, named according to the
 *	  component's unique routing key.
 *
 *	o Each component may create multiple bindings for its queue, but this
 *	  manager always creates at least one binding for the component's unique
 *	  routing key.
 *
 *	o Default settings are suitable for the exchange, queues, bindings, and
 *	  messages.
 *
 *	o All messages are encoded JSON objects.
 *
 * This manager does three things:
 *
 *	o Manages the connection to the AMQP broker according to an optional
 *	  disconnect-retry policy.
 *
 *	o Sends messages on behalf of the consumer.
 *
 *	o Dispatches received messages to the consumer via events.
 *
 * The constructor initializes the manager but doesn't actually contact the AMQP
 * broker until the 'start' method is invoked.  The constructor's 'conf'
 * argument must specify the following members:
 *
 *	broker		Describes the AMQP broker connection details, using the
 *			same form as amqp.createConnection.
 *
 *	exchange	Global exchange name.
 *
 *	exchange_opts	Global exchange creation options.
 *
 *	basename	Base used as a template for generating a unique routing
 *			key for this component.  The basename will be prepended
 *			to the hostname to generate the unique key.  This is
 *			used for the queue name as well as the first binding on
 *			the queue.
 *
 *	hostname	Unique identifier string for this component.  This
 *			identifier must be unique within the system.
 *
 *	bindings	Array of additional routing keys to which to bind the
 *			queue.  The queue is automatically bound to the unique
 *			routing key specified by basename and hostname.
 *
 * The constructor's 'conf' argument may also specify the following members:
 *
 *	retry_interval	Number of seconds to wait between connection retries.
 *			This is the base of an exponential backoff algorithm.
 *			Default: 5 seconds
 *
 *	retry_limit	Maximum number of times to retry consecutively when an
 *			established connection to the AMQP broker is lost.  0
 *			means to avoid retrying at all.  If this field is not
 *			specified, retry indefinitely.  The initial connection
 *			is never retried.
 *
 * This manager emits the following events:
 *
 *	amqp-error	Indicates an error occured on the AMQP service.  If the
 *			connection was closed, this object will automatically
 *			try to reconnect according to the retry policy.  Thus,
 *			this event is only for notification purposes; there's
 *			nothing to be done in response.  Argument: error.
 *
 *	amqp-fatal	Indicates a persistent failure to connect to the AMQP
 *			broker.  When this event is emitted, the retry policy
 *			has been exhausted and we've given up.  This object has
 *			stopped sending and receiving messages.  Argument:
 *			error.
 *
 *	msg		A message was received.  Argument: the message, as
 *			transmitted.
 */
function caAmqp(conf)
{
	var ii;

	mod_events.EventEmitter.call(this);

	this.caa_broker = conf['broker'];
	this.caa_exchange_name = conf['exchange'];
	this.caa_exchange_opts = conf['exchange_opts'];
	this.caa_hostname = conf['hostname'];
	this.caa_queue_name = conf['basename'] + this.caa_hostname;
	this.caa_bindings = [];
	this.caa_wqueue = [];

	for (ii = 0; ii < conf['bindings'].length; ii++)
		this.caa_bindings.push(conf['bindings'][ii]);

	this.caa_ncloses = 0;
}

mod_sys.inherits(caAmqp, mod_events.EventEmitter);
exports.caAmqp = caAmqp;

/*
 * Returns the unique routing key for this component.
 */
caAmqp.prototype.routekey = function ()
{
	return (this.caa_queue_name);
};

/*
 * Connect to the AMQP broker and begin receiving messages.
 */
caAmqp.prototype.start = function (cb)
{
	var cfgamqp = this;

	this.caa_closing = false;
	this.caa_conn = mod_amqp.createConnection(this.caa_broker);
	this.caa_conn.on('ready', function () { cfgamqp.connSetup(cb); });
	this.caa_conn.on('error', function (err) { cfgamqp.connError(err); });
	this.caa_conn.on('close', function (err) { cfgamqp.connClosed(err); });
};

/*
 * Invoked after we've finished the AMQP handshake to initialize the exchange,
 * queues, and bindings.  Notify the caller via 'callback' when the exchange is
 * open (note that we haven't necessarily completed binding by that point).
 */
caAmqp.prototype.connSetup = function (callback)
{
	var cfgamqp = this;
	var conn = this.caa_conn;
	var promise, nbindings, donebinding;

	this.caa_notfirst = true;
	this.caa_ncloses = 0;
	this.caa_exchange = conn.exchange(this.caa_exchange_name,
	    this.caa_exchange_opts);
	this.caa_exchange.on('open', function () {
		var queue, ii;

		queue = conn.queue(cfgamqp.caa_queue_name, { exclusive: true },
		    function () {
			queue.subscribe(
			    function (msg) { cfgamqp.receive(msg); });

			donebinding = function () {
				if (--nbindings !== 0)
					return;

				/*
				 * Publish all of the queued messages.
				 */
				for (; queue.length > 0; ) {
					var m = cfgamqp.caa_wqueue.pop();
					cfgamqp.caa_exchange.publish(
					    m.caw_key, m.caw_msg);
				}

				if (callback)
					callback();
			};

			nbindings = cfgamqp.caa_bindings.length + 1;
			promise = queue.bind(cfgamqp.caa_exchange_name,
			    cfgamqp.caa_queue_name);
			promise.addCallback(donebinding);

			for (ii = 0; ii < cfgamqp.caa_bindings.length; ii++) {
				promise = queue.bind(cfgamqp.caa_exchange_name,
				    cfgamqp.caa_bindings[ii]);
				promise.addCallback(donebinding);
			}
		});
	});
};

/*
 * Invoked when the AMQP service encounters an error.  We emit this to the
 * consumer for logging purposes but there's no action to be taken unless the
 * connection becomes closed.
 */
caAmqp.prototype.connError = function (error)
{
	this.emit('amqp-error', error);
};

/*
 * Invoked when the AMQP connection has been closed, as may result from an
 * error.  If we've exceeded our consecutive retry count, we give up and emit
 * 'amqp-fatal'.
 */
caAmqp.prototype.connClosed = function ()
{
	var cfgamqp = this;
	var ntries = this.caa_retry_count;
	var interval = this.caa_retry_interval;

	if (this.caa_closing)
		return;

	this.caa_ncloses++;

	if (!this.caa_notfirst || this.caa_ncloses >= ntries) {
		this.emit('amqp-fatal', new Error(
		    'failed to reconnect after ' + this.caa_ncloses +
		    ' tries'));
		return;
	}

	this.caa_exchange = null;
	this.caa_conn = null;
	setTimeout(function () { cfgamqp.start(); },
	    interval * Math.pow(2, this.caa_ncloses - 1));
};

/*
 * Invoked when we receive a new AMQP message to dispatch to our consumer.
 */
caAmqp.prototype.receive = function (msg)
{
	this.emit('msg', msg);
};

/*
 * Send a given message over the global exchange to the specified routing key.
 */
caAmqp.prototype.send = function (key, msg)
{
	/*
	 * There is a race between calling the start function and getting the
	 * caa_conn.on('ready') callback. There is also a chance that we have
	 * disconnected and are trying to reconnect. In both of these cases
	 * calling publish will fail, so we queue this up until we get that the
	 * connection is ready, at which point we dump everything out and send
	 * as normal.
	 */
	if (this.caa_exchange === undefined || this.caa_exchange === null) {
		var wmsg = {};
		wmsg.caw_key = key;
		wmsg.caw_msg = msg;
		this.caa_wqueue.push(wmsg);
		return;
	}

	this.caa_exchange.publish(key, msg);
};

/*
 * Creates a binding for the specified routing key to this component's queue.
 */
caAmqp.prototype.bind = function (routekey, callback)
{
	var queue, promise;

	queue = this.caa_conn.queue(this.caa_queue_name);
	promise = queue.bind(this.caa_exchange_name, routekey);
	promise.addCallback(callback);
	this.caa_bindings.push(routekey);
};

caAmqp.prototype.stop = function ()
{
	this.caa_closing = true;
	this.caa_conn.end();
};

/*
 * Default AMQP error functions for use by caAmqp consumers.  Note that
 * caAmqpFatal shuts down the process, not necessarily gracefully.
 */
exports.caAmqpLogError = function (log)
{
	return (function (error) {
		log.warn('warning: amqp: %s', error.message);
	});
};

exports.caAmqpFatalError = function (log)
{
	return (function (error) {
		log.error('fatal error: amqp: ' + error.message);
		log.error('failed to maintain AMQP connection.  ' +
		    'shutting down.');
		process.exit(3);
	});
};

/*
 * camon.js: basic monitoring tool for Cloud Analytics
 */

window.onload = camInit;

var camInputHost;		/* input element for host field */
var camContainer;		/* container div for all monitors */
var camTimeout = 5; 		/* seconds to wait for server subrequests */

var camHostChangedEver = false;

function camInit()
{
	var default_host = window.location.hostname + ':' + 23181;

	camInputHost = document.getElementById('camHost');
	camContainer = document.getElementById('camContainer');

	if (camInputHost.value === '')
		camInputHost.value = default_host;
}

/*
 * Invoked when the user adds a new service to monitor.
 */
function camAddMonitor()
{
	var monitor;

	monitor = new camMonitor(camInputHost.value, function () {
		camContainer.removeChild(monitor.camElement);
	});
	camContainer.appendChild(monitor.camElement);
	monitor.refresh();
}

/*
 * A monitor is a widget which monitors a particular URL at some interval.  The
 * default interval is 30 seconds but can be changed by the user.  It exports a
 * camElement property that represents the corresponding DOM element.
 */
function camMonitor(host, remove)
{
	var div, elt, span, button;
	var monitor = this;

	this.cam_host = host;
	this.cam_frequency = 30; /* seconds */
	this.cam_display = new camMonitorDisplay();
	this.cam_freqctl = document.createElement('input');
	this.cam_freqctl.type = 'text';
	this.cam_freqctl.size = 3;
	this.cam_freqctl.value = this.cam_frequency;
	$(this.cam_freqctl).change(function () { monitor.frequencyChanged(); });

	div = document.createElement('div');
	$(div).addClass('camMonitor');

	elt = div.appendChild(document.createElement('div'));
	$(elt).addClass('camMonitorControl');

	button = elt.appendChild(document.createElement('span'));
	$(button).addClass('camButton');
	$(button).button({ text: true, label: 'Delete' });
	$(button).click(function () {
		monitor.cam_frequency = 0;
		remove();
	});

	button = elt.appendChild(document.createElement('span'));
	$(button).addClass('camButton');
	$(button).button({ text: true, label: 'Refresh Now' });
	$(button).click(function () { monitor.refresh(); });

	elt.appendChild(document.createTextNode('Refresh every '));
	elt.appendChild(this.cam_freqctl);
	elt.appendChild(document.createTextNode(' seconds.  '));

	span = elt.appendChild(document.createElement('span'));
	span.appendChild(document.createTextNode('Last refreshed: '));

	span = elt.appendChild(document.createElement('span'));
	span.appendChild(document.createTextNode('never'));
	this.cam_last = span;

	div.appendChild(this.cam_display.camElement);
	this.camElement = div;
}

camMonitor.prototype.frequencyChanged = function ()
{
	var value;

	value = parseInt(this.cam_freqctl.value, 10);
	if (isNaN(value))
		return;

	this.cam_frequency = value;
	this.refresh();
};

camMonitor.prototype.refresh = function (callback)
{
	var monitor = this;
	var url;

	if (this.cam_refreshing)
		return;

	if (this.cam_timeout)
		clearTimeout(this.cam_timeout);

	url = 'http://' + this.cam_host + '/ca/admin/status?timeout=' +
	    camTimeout + '&recurse=true';
	this.cam_refreshing = true;
	$.getJSON(url, function (result) {
		monitor.cam_refreshing = false;
		monitor.cam_display.update(result);
		monitor.cam_last.replaceChild(
		    document.createTextNode(new Date()),
		    monitor.cam_last.firstChild);

		if (!monitor.cam_frequency)
			return;

		monitor.cam_timeout = setTimeout(
		    function () { monitor.refresh(); },
		    monitor.cam_frequency * 1000);
	});
};

/*
 * Manages the display of a particular monitor.
 */
function camMonitorDisplay()
{
	var div;

	div = document.createElement('div');
	$(div).addClass('camMonitorTable');
	this.camElement = div;

}

camMonitorDisplay.prototype.update = function (data)
{
	var table, tr, th, td;
	var flattened, keys, ii;

	table = document.createElement('table');
	tr = table.appendChild(document.createElement('tr'));

	th = tr.appendChild(document.createElement('th'));
	$(th).addClass('camHeadParameter');
	th.appendChild(document.createTextNode('PARAMETER'));

	th = tr.appendChild(document.createElement('th'));
	$(th).addClass('camHeadValue');
	th.appendChild(document.createTextNode('VALUE'));

	flattened = camFlatten(data);
	keys = Object.keys(flattened).sort(function (aa, bb) {
		var aadots, bbdots;

		aadots = camCountDots(aa);
		bbdots = camCountDots(bb);

		if (aadots !== bbdots)
			return (aadots - bbdots);

		return (aa < bb ? -1 : aa > bb ? 1 : 0);
	});
	for (ii = 0; ii < keys.length; ii++) {
		tr = table.appendChild(document.createElement('tr'));
		td = tr.appendChild(document.createElement('td'));
		td.appendChild(document.createTextNode(keys[ii]));
		td = tr.appendChild(document.createElement('td'));
		td.appendChild(document.createTextNode(flattened[keys[ii]]));
	}

	if (this.camElement.childNodes.length > 0)
		this.camElement.replaceChild(table,
		    this.camElement.childNodes[0]);
	else
		this.camElement.appendChild(table);
};

/*
 * Flattens an arbitrary JSON object.  Returns an object mapping key => value
 * where each value is a string.
 */
function camFlatten(obj)
{
	var ret = {};

	camDoFlatten(obj, '', ret);
	return (ret);
}

function camDoFlatten(obj, prefix, ret)
{
	var key, ii;
	var subprefix;

	if (typeof (obj) != typeof ({})) {
		ret[prefix] = obj;
		return;
	}

	subprefix = prefix.length === 0 ? prefix : prefix + '.';

	if (obj.constructor == Object) {
		for (key in obj)
			camDoFlatten(obj[key], subprefix + key, ret);
		return;
	}

	if (obj.constructor != Array) {
		ret[prefix] = obj;
		return;
	}

	/*
	 * For arrays whose elements are simple, we print out the array as a
	 * single field.  For arrays whose elements are themselves other
	 * objects, we descend recursively.  For this heuristic, we assume
	 * all array elements have the same type.
	 */
	if (obj.length === 0 || typeof (obj[0]) != typeof ({})) {
		ret[prefix] = obj.toString();
		return;
	}

	for (ii = 0; ii < obj.length; ii++)
		camDoFlatten(obj[ii], prefix + '[' + ii + ']', ret);
}

function camCountDots(str)
{
	if (str.indexOf('.') == -1)
		return (0);

	return (1);
}

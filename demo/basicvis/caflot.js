/*
 * caflot.js: flot-based visualization of CA metrics for demo
 */

var gnDataPoints = 30;	/* seconds */
var gOptions = {
	series: { lines: { show: true, fill: true } },
	xaxis: { mode: 'time', ticks: 5 },
	yaxis: { min: 0 }
};

var gServer = window.location.hostname;
var gBaseUrlValue = 'http://' + gServer + ':23182/instrumentation/';
var gBaseUrlCreate = 'http://' + gServer + ':23181/instrumentation';
var gBaseUrlMetrics = 'http://' + gServer + ':23181/metrics';

function gUrlValue(id)
{
	return (gBaseUrlValue + id + '/value');
}

function gUrlCreate()
{
	return (gBaseUrlCreate);
}

function gUrlDelete(id)
{
	return (gBaseUrlCreate + '/' + id);
}

function gUrlMetrics()
{
	return (gBaseUrlMetrics);
}

var gId = 0;
var gGraphs = [];

function gAddStat()
{
	var selector = document.getElementById('gStatSelector');
	var option = selector.options[selector.selectedIndex];
	var metric = gMetrics[option.value];
	var data = [];
	var ii;
	var container = document.getElementById('gContainerDiv');
	var div = document.createElement('div');
	var id = gId++;
	div.className = 'graph';
	div.id = 'graph' + id;
	div.style.width = '600px';
	div.style.height = '300px';
	container.appendChild(div);

	var link = container.appendChild(document.createElement('input'));
	link.style.display = 'inline';
	link.type = 'button';
	link.value = 'Delete';
	link.onclick = function () {
		gRemoveStat(id, div, link);
	};

	for (ii = 0; ii < gnDataPoints; ii++)
		data.push(null);

	var body = 'module=' + metric.module + '&stat=' + metric.stat;
	var request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 201) {
			link.parentNode.removeChild(link);
			alert('failed to create stat: ' + request.statusText);
			return;
		}

		var val = JSON.parse(request.responseText);
		setTimeout(function () {
			gGraphs.push({
				inst_id: val.id,
				label: option.text,
				div: div,
				data: data
			});
		}, 1000);
	};
	request.open('POST', gUrlCreate(), true);
	request.setRequestHeader('Content-Type',
	    'application/x-www-form-urlencoded');
	request.send(body);
}

function gRemoveStat(ii, div, link)
{
	var request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to delete stat: ' + request.statusText);
			return;
		}

		div.parentNode.removeChild(div);
		link.parentNode.removeChild(link);
	};

	request.open('DELETE', gUrlDelete(gGraphs[ii].inst_id), true);
	request.send(null);
	delete (gGraphs[ii]);
}

window.onload = function ()
{
	gInitMetrics();
	setTimeout(gTick, 0);
};

function gFillData(ii)
{
	return (function (datum) {
		var data;

		gGraphs[ii].data.shift();
		gGraphs[ii].data.push(datum);
		data = gRecomputeData(gGraphs[ii].label, gGraphs[ii].data);
		$.plot(gGraphs[ii].div, data, gOptions);
	});
}

function gTick()
{
	var ii;

	for (ii = 0; ii < gGraphs.length; ii++) {
		if (!gGraphs[ii])
			continue;

		gRetrieveData(ii, gFillData(ii));
	}

	setTimeout(gTick, 1000);
}

function gRecomputeData(label, rawdata)
{
	var ii;
	var points = [];

	/*
	 * Iterate backwards to back-fill NULL values with zero.  This should
	 * really be filled with some other pattern to indicate "no data".
	 */
	for (ii = gnDataPoints - 1; ii >= 0; ii--) {
		if (rawdata[ii] !== null || ii == gnDataPoints - 1) {
			points[ii] = rawdata[ii];
			continue;
		}

		/* XXX avoid hardcoding knowledge of data format? */
		points[ii] =
		    [ new Date(points[ii + 1][0].getTime() - 1000), 0 ];
	}

	return ([ { label: label, data: points } ]);
}

function gRetrieveData(ii, callback)
{
	var request;
	var url = gUrlValue(gGraphs[ii].inst_id);

	request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		var val = JSON.parse(request.responseText);
		callback([ new Date(val.when * 1000), val.value ]);
	};

	request.open('GET', url, true);
	request.send(null);
}

/*
 * Retrieve list of available metrics from the server and populate 'select' box.
 */
function gInitMetrics()
{
	var request;

	request = new XMLHttpRequest();
	request.onreadystatechange = function () {
		if (request.readyState != 4)
			return;

		if (request.status != 200) {
			alert('failed to load metric list');
			return;
		}

		var val = JSON.parse(request.responseText);
		gInitMetricsFini(val);
	};
	request.open('GET', gUrlMetrics(), true);
	request.send(null);
}

var gMetrics = [];

function gInitMetricsFini(metrics)
{
	var modname, module, statname, stat, optname;
	var elt, ii, option;

	for (modname in metrics) {
		module = metrics[modname];

		for (statname in module['stats']) {
			stat = module['stats'][statname];
			optname = module['label'] + ': ' + stat['label'];
			optname += ' (' + modname + '.' + statname + ')';
			gMetrics.push({
				module: modname,
				stat: statname,
				label: optname,
				type: stat['type']
			});
		}
	}

	elt = document.getElementById('gStatSelector');
	for (ii = 0; ii < gMetrics.length; ii++) {
		option = elt.appendChild(document.createElement('option'));
		option.value = ii;
		option.appendChild(document.createTextNode(gMetrics[ii].label));
	}

	elt = document.getElementById('gStatAddButton');
	elt.disabled = false;
}

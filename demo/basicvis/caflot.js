var gnDataPoints = 30;
var gOptions = {
	series: { lines: { show: true, fill: true } },
	xaxis: { mode: 'time', ticks: 5 },
	yaxis: { min: 0 }
};

var gServer = '192.168.3.7';
var gBaseUrlValue = 'http://' + gServer + ':23182/instrumentation/';
var gBaseUrlCreate = 'http://' + gServer + ':23181/instrumentation';

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

var gId = 0;
var gGraphs = [];

function gAddStat()
{
	var selector = document.getElementById('gStatSelector');
	var option = selector.options[selector.selectedIndex];
	var parts = option.value.split('.');
	var metric = { module: parts[0], stat: parts[1] };
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
	}

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
	var ii, data;
	var points = [];

	for (ii = 0; ii < gnDataPoints; ii++)
		points[ii] = rawdata[ii];

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
	}

	request.open('GET', url, true);
	request.send(null);
}

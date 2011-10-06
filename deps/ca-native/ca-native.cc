#include <v8.h>
#include <node.h>
#include <zone.h>
#include <errno.h>

using namespace v8;

Handle<Value> call_zonenamebyid(const Arguments& args)
{
	char buf[ZONENAME_MAX];
	zoneid_t zid;
	HandleScope scope;

	if (args.Length() != 1 || !args[0]->IsInt32())
		return (ThrowException(node::ErrnoException(EINVAL)));

	zid = args[0]->Int32Value();
	if (getzonenamebyid(zid, buf, sizeof (buf)) < 0)
		return (ThrowException(node::ErrnoException(errno)));

	return (scope.Close(String::New(buf)));
}

extern "C" void
init (Handle<Object> target) 
{
	HandleScope scope;
	Local<FunctionTemplate> templ =
	    FunctionTemplate::New(call_zonenamebyid);

	target->Set(String::NewSymbol("zoneNameById"), templ->GetFunction());
}

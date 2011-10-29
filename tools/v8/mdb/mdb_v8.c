/*
 * mdb(1M) module for debugging the V8 JavaScript engine.  This implementation
 * assumes 32-bit x86.
 */

#include <assert.h>
#include <ctype.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include <sys/mdb_modapi.h>

#include "heap-dbg-common.h"
#include "heap-dbg-constants.h"
#include "heap-dbg-inl.h"

/*
 * Describes the V8 "InstanceType" enum values that do NOT represent string
 * types.  String types (having value less than 0x80) are determined
 * programmatically. XXX This should be auto-generated.
 */
typedef struct {
	const char 	*v8e_name;
	uint_t		v8e_value;
	uint_t		v8e_aux;
} v8_enum_t;

static v8_enum_t v8_types[] = {
	{ "Map", 			V8_FirstNonstringType	},
	{ "Code" 						},
	{ "Oddball" 						},
	{ "JSGlobalPropertyCell"				},
	{ "HeapNumber"						},
	{ "Proxy"						},
	{ "ByteArray" 						},
	{ "PixelArray"						},
	{ "ExternalByteArray"					},
	{ "ExternalUnsignedByteArray"				},
	{ "ExternalShortArray"					},
	{ "ExternalUnsignedShortArray"				},
	{ "ExternalIntArray"					},
	{ "ExternalUnsignedIntArray"				},
	{ "ExternalFloatArray"					},
	{ "Filler"						},
	{ "AccessorInfo"					},
	{ "AccessCheckInfo"					},
	{ "InterceptorInfo"					},
	{ "CallHandlerInfo"					},
	{ "FunctionTemplateInfo"				},
	{ "ObjectTemplateInfo"					},
	{ "SignatureInfo"					},
	{ "TypeSwitchInfo"					},
	{ "Script"						},
	{ "CodeCache"						},
	{ "DebugInfo"						},
	{ "BreakPointInfo"					},
	{ "FixedArray"						},
	{ "SharedFunctionInfo"					},
	{ "JSMessageObject"					},
	{ "JSValue"						},
	{ "JSObject"						},
	{ "JSContextExtensionObject"				},
	{ "JSGlobalObject"					},
	{ "JSBuiltinsObject"					},
	{ "JSGlobalProxy"					},
	{ "JSArray"						},
	{ "JSRegexp"						},
	{ "JSFunction"						},
	{ NULL }
};

/*
 * Describe's V8 stack frame types. XXX This should be auto-generated.
 */
static v8_enum_t v8_frametypes[] = {
	{ "None",			0 },
	{ "EntryFrame"			  },
	{ "EntryConstructFrame"		  },
	{ "ExitFrame"		  	  },
	{ "JavaScriptFrame"		  },
	{ "OptimizedFrame"		  },
	{ "InternalFrame"		  },
	{ "ConstructFrame"		  },
	{ "ArgumentsAdaptorFrame"	  },
	{ NULL }
};

/*
 * Describes "roots_" offsets for special JavaScript values.
 */
static v8_enum_t v8_specials[] = {
	{ "undefined",		0,	V8_OFF_ROOTS_VALUE_UNDEFINED	},
	{ "null",		0,	V8_OFF_ROOTS_VALUE_NULL		},
	{ "true",		0,	V8_OFF_ROOTS_VALUE_TRUE		},
	{ "false",		0,	V8_OFF_ROOTS_VALUE_FALSE	},
	{ "NaN",		0,	V8_OFF_ROOTS_VALUE_NAN		},
	{ "-0",			0,	V8_OFF_ROOTS_VALUE_MINZERO	},
	{ NULL }
};

/*
 * For convenience, we allow the offset to be omitted for fields specified
 * above.  We fill in the true offset here as well as the "end" field.
 * XXX will be removed when we actually encode offsets in generated code
 */
static void
init_classes(void)
{
	v8_class_t *clp, **clpp;
	v8_field_t *flp;

	for (clpp = v8_classes; *clpp != NULL; clpp++) {
		clp = *clpp;
		assert(clp->v8c_start == 0);
		assert(clp->v8c_end == 0);

		if (clp->v8c_parent != NULL) {
			/* XXX assert parent must be defined first. */
			assert(clp->v8c_parent->v8c_end > 0 ||
			    clp->v8c_parent->v8c_fields->v8f_name == NULL);
			clp->v8c_start = clp->v8c_parent->v8c_end;
		}

		clp->v8c_end = clp->v8c_start;
		for (flp = &clp->v8c_fields[0]; flp->v8f_name != NULL; flp++)
			clp->v8c_end += flp->v8f_size;
	}
}

/*
 * For convenience, we allow values to be omitted from the structures describing
 * the InstanceType and frame enums above.  We fill in the true values here
 * using the same rules as for standard C enum definitions.
 * XXX This will be removed when this becomes auto-generated.
 */
static void
init_enum(v8_enum_t *enums)
{
	v8_enum_t *itp;
	uint_t val = 0;

	for (itp = enums; itp->v8e_name != NULL; itp++) {
		if (itp->v8e_value == 0)
			itp->v8e_value = val;

		val = itp->v8e_value + 1;
	}
}

static void
init_specials(void)
{
	v8_enum_t *itp;
	uintptr_t roots, value;
	GElf_Sym sym;

	if (mdb_lookup_by_name(V8_HEAP_ROOTS_SYM, &sym) != 0) {
		mdb_warn("failed to locate \"%s\"", V8_HEAP_ROOTS_SYM);
		return;
	}

	roots = (uintptr_t)sym.st_value;

	for (itp = v8_specials; itp->v8e_name != NULL; itp++) {
		if (mdb_vread(&value, sizeof (value),
		    roots + itp->v8e_aux * sizeof (uintptr_t)) == -1) {
			mdb_warn("failed to read address of \"%s\" value (%p)",
			    itp->v8e_name,
			    roots + itp->v8e_aux * sizeof (uintptr_t));
			continue;
		}

		itp->v8e_value = value;
	}
}

/*
 * Utility functions
 */
static int jsstr_print(uintptr_t, boolean_t, char **, size_t *);

static const char *
enum_lookup_str(v8_enum_t *enums, int val, const char *dflt)
{
	v8_enum_t *ep;

	for (ep = enums; ep->v8e_name != NULL; ep++) {
		if (ep->v8e_value == val)
			return (ep->v8e_name);
	}

	return (dflt);
}

static void
enum_print(v8_enum_t *enums)
{
	v8_enum_t *itp;

	for (itp = enums; itp->v8e_name != NULL; itp++)
		mdb_printf("%-30s = 0x%02x\n", itp->v8e_name, itp->v8e_value);
}

static size_t
bvsnprintf(char **bufp, size_t *buflenp, const char *format, va_list alist)
{
	size_t rv, len;

	if (*buflenp == 0)
		return (vsnprintf(NULL, 0, format, alist));

	rv = vsnprintf(*bufp, *buflenp, format, alist);

	len = MIN(rv, *buflenp);
	*buflenp -= len;
	*bufp += len;

	return (len);
}

static size_t
bsnprintf(char **bufp, size_t *buflenp, const char *format, ...)
{
	va_list alist;
	size_t rv;

	va_start(alist, format);
	rv = bvsnprintf(bufp, buflenp, format, alist);
	va_end(alist);

	return (rv);
}

static int
read_heap_ptr(uintptr_t *valp, uintptr_t addr, uintptr_t off)
{
	if (mdb_vread(valp, sizeof (*valp), addr + off) == sizeof (*valp))
		return (0);

	mdb_warn("failed to read heap value at %p", addr + off);
	return (-1);
}

static int
read_heap_smi(uintptr_t *valp, uintptr_t addr, uintptr_t off)
{
	if (mdb_vread(valp, sizeof (*valp), addr + off) != sizeof (*valp)) {
		mdb_warn("failed to read heap value at %p", addr + off);
		return (-1);
	}

	if ((*valp & V8_SmiTagMask) != V8_SmiTag) {
		mdb_warn("expected SMI, got %p\n", *valp);
		return (-1);
	}

	*valp = V8_SMI_VALUE(*valp);
	return (0);
}

/*
 * Given a heap object, returns in *valp the byte describing the type of the
 * object.  This is shorthand for first retrieving the Map at the start of the
 * heap object and then retrieving the type byte from the Map object.
 */
static int
read_typebyte(uint8_t *valp, uintptr_t addr)
{
	uintptr_t mapaddr;

	if (read_heap_ptr(&mapaddr, addr, -1) != DCMD_OK)
		return (-1);

	if ((mapaddr & V8_HeapObjectTagMask) != V8_HeapObjectTag) {
		mdb_warn("heap object map is not itself a heap object\n");
		return (-1);
	}

	if (mdb_vread(valp, sizeof (*valp),
	    mapaddr + V8_OFF_MAP_INSTANCE_ATTRIBUTES) != sizeof (*valp)) {
		mdb_warn("failed to read type byte");
		return (-1);
	}

	return (0);
}

/*
 * Returns in "buf" a description of the type of "addr".
 */
static int
obj_jstype(uintptr_t addr, char **bufp, size_t *lenp, uint8_t *typep)
{
	uint8_t typebyte;
	const char *spec;

	if ((addr & V8_FailureTagMask) == V8_FailureTag) {
		if (typep)
			*typep = 0;
		(void) bsnprintf(bufp, lenp, "'Failure' object");
		return (0);
	}

	if ((addr & V8_SmiTagMask) == V8_SmiTag) {
		if (typep)
			*typep = 0;
		(void) bsnprintf(bufp, lenp, "SMI: value = %d",
		    V8_SMI_VALUE(addr));
		return (0);
	}

	if (read_typebyte(&typebyte, addr) != 0)
		return (-1);

	if (typep)
		*typep = typebyte;

	if ((typebyte & V8_IsNotStringMask) != V8_StringTag) {
		(void) bsnprintf(bufp, lenp,
		    enum_lookup_str(v8_types, typebyte, "<unknown>"));

		if ((spec = enum_lookup_str(v8_specials, addr, NULL)) != NULL)
			bsnprintf(bufp, lenp, " \"%s\"", spec);

		return (0);
	}

	(void) bsnprintf(bufp, lenp,
	    (typebyte & V8_StringEncodingMask) == V8_AsciiStringTag ?
	    "ascii " : "two-byte ");

	switch (typebyte & V8_StringRepresentationMask) {
	case V8_SeqStringTag:
		(void) bsnprintf(bufp, lenp, "SeqString");
		break;
	case V8_ConsStringTag:
		(void) bsnprintf(bufp, lenp, "ConsString");
		break;
	case V8_ExternalStringTag:
		(void) bsnprintf(bufp, lenp, "ExternalString");
		break;
	}

	return (0);
}

/*
 * Print out the fields of the given object that come from the given class.
 */
static int
obj_print_fields(uintptr_t baddr, v8_class_t *clp)
{
	v8_field_t *flp;
	uintptr_t addr, value;
	int rv;
	char *bufp;
	size_t len;
	uint8_t type;
	char buf[256];

	for (flp = clp->v8c_fields; flp->v8f_name != NULL; flp++) {
		bufp = buf;
		len = sizeof (buf);

		addr = baddr + flp->v8f_offset;
		assert(flp->v8f_size == sizeof (uintptr_t));
		rv = mdb_vread((void *)&value, sizeof (value), addr);

		if (rv != sizeof (value) ||
		    obj_jstype(value, &bufp, &len, &type) != 0) {
			mdb_printf("%p %s (unreadable)\n", addr, flp->v8f_name);
			continue;
		}

		if (type != 0 && (type & V8_IsNotStringMask) == V8_StringTag) {
			(void) bsnprintf(&bufp, &len, ": \"");
			(void) jsstr_print(value, B_FALSE, &bufp, &len);
			(void) bsnprintf(&bufp, &len, "\"");
		}

		mdb_printf("%p %s = %p (%s)\n", addr, flp->v8f_name, value,
		    buf);
	}

	return (DCMD_OK);
}

/*
 * Print out all fields of the given object, starting with the root of the class
 * hierarchy and working down the most specific type.
 */
static int
obj_print_class(uintptr_t addr, v8_class_t *clp)
{
	int rv = 0;

	/*
	 * If we have no fields, we just print a simple inheritance hierarchy.
	 * If we have fields but our parent doesn't, our header includes the
	 * inheritance hierarchy.
	 */
	if (clp->v8c_end == 0) {
		mdb_printf("%s ", clp->v8c_name);

		if (clp->v8c_parent != NULL) {
			mdb_printf("< ");
			(void) obj_print_class(addr, clp->v8c_parent);
		}

		return (0);
	}

	mdb_printf("%p %s", addr, clp->v8c_name);

	if (clp->v8c_start == 0 && clp->v8c_parent != NULL) {
		mdb_printf(" < ");
		(void) obj_print_class(addr, clp->v8c_parent);
	}

	mdb_printf(" {\n");
	(void) mdb_inc_indent(4);

	if (clp->v8c_start > 0 && clp->v8c_parent != NULL)
		rv = obj_print_class(addr, clp->v8c_parent);

	rv |= obj_print_fields(addr, clp);
	(void) mdb_dec_indent(4);
	mdb_printf("}\n");

	return (rv);
}

/*
 * Print the ASCII string for the given field value.
 */
static int
jsstr_print(uintptr_t addr, boolean_t verbose, char **bufp, size_t *lenp)
{
	uint8_t typebyte;
	uintptr_t len, rlen, ptr1, ptr2;
	int err = 0;
	char *lbufp;
	size_t llen;
	char buf[256];

	if (read_typebyte(&typebyte, addr) != 0)
		return (0);

	if ((typebyte & V8_IsNotStringMask) != V8_StringTag) {
		(void) bsnprintf(bufp, lenp, "<invalid string>");
		return (0);
	}

	if ((typebyte & V8_StringEncodingMask) != V8_AsciiStringTag) {
		(void) bsnprintf(bufp, lenp, "<two-byte string>");
		return (0);
	}

	if (verbose) {
		lbufp = buf;
		llen = sizeof (buf);
		(void) obj_jstype(addr, &lbufp, &llen, NULL);
		mdb_printf("%s\n", buf);
		(void) mdb_inc_indent(4);
	}

	switch (typebyte & V8_StringRepresentationMask) {
	case V8_SeqStringTag:
		err |= read_heap_smi(&len, addr, V8_OFF_STRING_LENGTH);

		if (err != 0)
			break;

		rlen = len <= sizeof (buf) - 1 ? len :
		    sizeof (buf) - sizeof ("[...]");

		if (verbose)
			mdb_printf("length: %d, will read: %d\n", len, rlen);

		buf[0] = '\0';

		if (rlen > 0 && mdb_readstr(buf, rlen + 1,
		    addr + V8_OFF_SEQASCIISTRING_CHARS) == -1) {
			mdb_warn("failed to read SeqString data");
			err = -1;
			break;
		}

		if (rlen != len)
			(void) strlcat(buf, "[...]", sizeof (buf));

		if (verbose)
			mdb_printf("value: \"%s\"\n", buf);

		(void) bsnprintf(bufp, lenp, "%s", buf);
		break;

	case V8_ConsStringTag:
		err |= read_heap_ptr(&ptr1, addr, V8_OFF_CONSSTRING_FIRST);
		err |= read_heap_ptr(&ptr2, addr, V8_OFF_CONSSTRING_SECOND);

		if (err == 0) {
			if (verbose) {
				mdb_printf("ptr1: %p\n", ptr1);
				mdb_printf("ptr2: %p\n", ptr2);
			}

			err |= jsstr_print(ptr1, verbose, bufp, lenp);
		}

		if (err == 0)
			err |= jsstr_print(ptr2, verbose, bufp, lenp);

		break;

	case V8_ExternalStringTag:
		if (verbose)
			mdb_printf("assuming Node.js string\n");

		err |= read_heap_ptr(&ptr1, addr,
		    V8_OFF_EXTERNALSTRING_RESOURCE);
		err |= read_heap_ptr(&ptr2, ptr1, NODE_OFF_EXTSTR_DATA);

		if (err == 0 && mdb_readstr(buf, sizeof (buf), ptr2) == -1) {
			mdb_warn("failed to read ExternalString data");
			err = -1;
		}

		if (buf[0] != '\0' && !isascii(buf[0])) {
			mdb_warn("failed to read ExternalString ascii data");
			err = -1;
		}

		if (err == 0)
			(void) bsnprintf(bufp, lenp, "%s", buf);

		break;
	}

	if (verbose)
		(void) mdb_dec_indent(4);

	return (err);
}

/*
 * Fill in "buf" with the line number of the given token position using the line
 * endings table in "lendsp".
 */
static int
jsfunc_lineno(uintptr_t lendsp, uintptr_t tokpos, char *buf, size_t buflen)
{
	uintptr_t size, bufsz, lower, upper, ii;
	uintptr_t *data;

	if (strcmp(enum_lookup_str(v8_specials, lendsp, ""),
	    "undefined") == 0) {
		mdb_snprintf(buf, buflen, "position %d", tokpos);
		return (0);
	}

	if (read_heap_smi(&size, lendsp, V8_OFF_FIXEDARRAY_LENGTH) != 0)
		return (-1);

	bufsz = size * sizeof (data[0]);

	if ((data = mdb_alloc(bufsz, UM_NOSLEEP)) == NULL) {
		mdb_warn("failed to alloc %d bytes for FixedArray data", bufsz);
		return (-1);
	}

	if (mdb_vread(data, bufsz, lendsp + V8_OFF_FIXEDARRAY_DATA) != bufsz) {
		mdb_warn("failed to read FixedArray data");
		mdb_free(data, bufsz);
		return (-1);
	}

	lower = 0;
	upper = size - 1;

	if (tokpos > data[upper]) {
		(void) strlcpy(buf, "position out of range", buflen);
		mdb_free(data, bufsz);
		return (0);
	}

	if (tokpos <= data[0]) {
		(void) strlcpy(buf, "line 1", buflen);
		mdb_free(data, bufsz);
		return (0);
	}

	while (upper >= 1) {
		ii = (lower + upper) >> 1;
		if (tokpos > data[ii])
			lower = ii + 1;
		else if (tokpos <= data[ii - 1])
			upper = ii - 1;
		else
			break;
	}

	(void) mdb_snprintf(buf, buflen, "line %d", ii + 1);
	mdb_free(data, bufsz);
	return (0);
}

static int
jsfunc_name(uintptr_t funcinfop, char **bufp, size_t *lenp)
{
	uintptr_t ptrp;
	char *bufs = *bufp;

	if (read_heap_ptr(&ptrp, funcinfop,
	    V8_OFF_SHAREDFUNCTIONINFO_NAME) != 0 ||
	    jsstr_print(ptrp, B_FALSE, bufp, lenp) != 0)
		return (-1);

	if (*bufp != bufs)
		return (0);

	if (read_heap_ptr(&ptrp, funcinfop,
	    V8_OFF_SHAREDFUNCTIONINFO_INFERRED_NAME) != 0) {
		(void) bsnprintf(bufp, lenp, "<anonymous>");
		return (0);
	}

	(void) bsnprintf(bufp, lenp, "<anonymous> (as ");
	bufs = *bufp;

	if (jsstr_print(ptrp, B_FALSE, bufp, lenp) != 0)
		return (-1);

	if (*bufp == bufs)
		(void) bsnprintf(bufp, lenp, "<anon>");

	(void) bsnprintf(bufp, lenp, ")");

	return (0);
}

/*
 * dcmd implementations
 */

/* ARGSUSED */
static int
dcmd_jsclasses(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	v8_class_t *clp, **clpp;

	for (clpp = v8_classes; *clpp != NULL; clpp++) {
		clp = *clpp;
		mdb_printf("%s\n", clp->v8c_name);
	}

	return (DCMD_OK);
}

static const char *jsprint_help =
    "Prints out \".\" (a V8 heap object) as an instance of its C++ class.\n"
    "With no arguments, the appropriate class is detected automatically.\n"
    "The 'class' argument overrides this to print an object as an instance\n"
    "of the given class.  The list of known classes can be viewed with \n"
    "::jsclasses.";

static void
dcmd_help_jsprint(void)
{
	mdb_printf(jsprint_help);
}

/* ARGSUSED */
static int
dcmd_jsprint(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	const char *rqclass;
	v8_class_t *clp, **clpp;
	char *bufp;
	size_t len;
	uint8_t type;
	char buf[256];

	if (argc < 1) {
		/*
		 * If no type was specified, determine it automatically.
		 */
		bufp = buf;
		len = sizeof (buf);
		if (obj_jstype(addr, &bufp, &len, &type) != 0)
			return (DCMD_ERR);

		if (type == 0) {
			/* SMI or 'Failure': just print out the type itself */
			mdb_printf("%s\n", buf);
			return (DCMD_OK);
		}

		if ((type & V8_IsNotStringMask) == V8_StringTag) {
			/*
			 * XXX shouldn't be a special case if we add the string
			 * types to the type enum
			 */
			(void) bsnprintf(&bufp, &len, ": \"");
			(void) jsstr_print(addr, B_FALSE, &bufp, &len);
			(void) bsnprintf(&bufp, &len, "\"");
			mdb_printf("%s\n", buf);
			return (DCMD_OK);
		}

		if ((rqclass = enum_lookup_str(v8_types, type, NULL)) == NULL) {
			mdb_warn("object has unknown type\n");
			return (DCMD_ERR);
		}
	} else {
		if (argv[0].a_type != MDB_TYPE_STRING)
			return (DCMD_USAGE);

		rqclass = argv[0].a_un.a_str;
	}

	for (clpp = v8_classes; *clpp != NULL; clpp++) {
		clp = *clpp;
		if (strcmp(rqclass, clp->v8c_name) == 0)
			break;
	}

	if (*clpp == NULL) {
		mdb_warn("unknown class '%s'\n", rqclass);
		return (DCMD_USAGE);
	}

	return (obj_print_class(addr, clp));
}

/* ARGSUSED */
static int
dcmd_jstype(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	char buf[64];
	char *bufp = buf;
	size_t len = sizeof (buf);

	if (obj_jstype(addr, &bufp, &len, NULL) != 0)
		return (DCMD_ERR);

	mdb_printf("0x%p: %s\n", addr, buf);
	return (DCMD_OK);
}

/* ARGSUSED */
static int
dcmd_jstypes(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	enum_print(v8_types);
	return (DCMD_OK);
}

/* ARGSUSED */
static int
dcmd_jsframe(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	uintptr_t ftype, funcp, funcinfop, tokpos, scriptp, lendsp, ptrp;
	boolean_t opt_v = B_FALSE;
	char typebuf[64];
	char funcname[64];
	char *bufp;
	size_t len;

	if (mdb_getopts(argc, argv, 'v', MDB_OPT_SETBITS, B_TRUE, &opt_v,
	    NULL) != argc)
		return (DCMD_USAGE);

	if (opt_v)
		mdb_printf("frame pointer: ");
	mdb_printf("%p", addr);
	if (opt_v)
		mdb_printf("\n");

	if (read_heap_ptr(&ftype, addr, V8_OFF_FP_MARKER) != 0)
		return (DCMD_ERR);

	if ((ftype & V8_SmiTagMask) == V8_SmiTag) {
		mdb_printf(" <%s>\n",
		    enum_lookup_str(v8_frametypes, V8_SMI_VALUE(ftype),
		    "<unknown>"));
		return (DCMD_OK);
	}

	if (read_heap_ptr(&funcp, addr, V8_OFF_FP_FUNCTION) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(funcp, &bufp, &len, NULL);
		mdb_printf("function: %p (%s)\n", funcp, typebuf);
	}

	if (read_heap_ptr(&funcinfop, funcp, V8_OFF_JSFUNCTION_SHARED) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(funcinfop, &bufp, &len, NULL);
		mdb_printf("shared function info: %p (%s)\n", funcinfop,
		    typebuf);
	}

	bufp = funcname;
	len = sizeof (funcname);
	if (jsfunc_name(funcinfop, &bufp, &len) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);

		if (read_heap_ptr(&ptrp, funcinfop,
		    V8_OFF_SHAREDFUNCTIONINFO_NAME) == 0) {
			bufp = typebuf;
			len = sizeof (typebuf);
			(void) obj_jstype(ptrp, &bufp, &len, NULL);
		} else {
			ptrp = 0;
			typebuf[0] = '\0';
		}

		mdb_printf("function name: %p (%s: \"%s\")\n", ptrp, typebuf,
		    funcname);
	} else {
		mdb_printf(" %s", funcname);
	}

	/*
	 * Although the token position is technically an SMI, we're going to
	 * byte-compare it to other SMI values so we don't want decode it here.
	 */
	if (read_heap_ptr(&tokpos, funcinfop,
	    V8_OFF_SHAREDFUNCTIONINFO_FUNCTION_TOKEN_POSITION) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(tokpos, &bufp, &len, NULL);
		mdb_printf("function token position: %s\n", typebuf);
	}

	if (read_heap_ptr(&scriptp, funcinfop,
	    V8_OFF_SHAREDFUNCTIONINFO_SCRIPT) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(scriptp, &bufp, &len, NULL);
		mdb_printf("script: %p (%s)\n", scriptp, typebuf);
	}

	if (read_heap_ptr(&ptrp, scriptp, V8_OFF_SCRIPT_NAME) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(ptrp, &bufp, &len, NULL);
		mdb_printf("script name: %p (%s: \"", ptrp, typebuf);

		bufp = typebuf;
		len = sizeof (typebuf);
		(void) jsstr_print(ptrp, B_FALSE, &bufp, &len);
		mdb_printf("%s\")\n", typebuf);
	} else {
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) jsstr_print(ptrp, B_FALSE, &bufp, &len);
		mdb_printf(" at %s ", typebuf);
	}

	if (read_heap_ptr(&lendsp, scriptp, V8_OFF_SCRIPT_LINE_ENDS) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(lendsp, &bufp, &len, NULL);
		mdb_printf("line endings: %p (%s)\n", lendsp, typebuf);

		(void) mdb_dec_indent(4);
		mdb_printf("function token at: ");
	}

	(void) jsfunc_lineno(lendsp, tokpos, typebuf, sizeof (typebuf));
	mdb_printf("%s\n", typebuf);

	if (opt_v) {
		(void) mdb_dec_indent(4);
		(void) mdb_dec_indent(4);
		(void) mdb_dec_indent(4);
	}

	return (DCMD_OK);
}

/* ARGSUSED */
static int
dcmd_jsstack(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	if (mdb_walk_dcmd("jsframe", "jsframe", argc, argv) == -1)
		return (DCMD_ERR);

	return (DCMD_OK);
}

/* ARGSUSED */
static int
dcmd_jsstr(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	boolean_t opt_v = B_FALSE;
	char buf[256];
	char *bufp;
	size_t len;

	if (mdb_getopts(argc, argv, 'v', MDB_OPT_SETBITS, B_TRUE, &opt_v,
	    NULL) != argc)
		return (DCMD_USAGE);

	bufp = buf;
	len = sizeof (buf);
	if (jsstr_print(addr, opt_v, &bufp, &len) != 0)
		return (DCMD_ERR);

	mdb_printf("%s\n", buf);
	return (DCMD_OK);
}

/* ARGSUSED */
static int
dcmd_jsvals(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	enum_print(v8_specials);
	return (DCMD_OK);
}

static int
walk_jsframes_init(mdb_walk_state_t *wsp)
{
	mdb_tid_t tid;
	mdb_reg_t reg;

	tid = wsp->walk_addr != NULL ?
	    (mdb_tid_t)wsp->walk_addr : 1;

	if (mdb_getareg(tid, "ebp", &reg) != 0) {
		mdb_warn("failed to read ebp for thread %d", tid);
		return (WALK_ERR);
	}

	wsp->walk_addr = (uintptr_t)reg;
	return (WALK_NEXT);
}

static int
walk_jsframes_step(mdb_walk_state_t *wsp)
{
	uintptr_t ftype, addr, next;
	int rv;

	addr = wsp->walk_addr;
	rv = wsp->walk_callback(wsp->walk_addr, NULL, wsp->walk_cbdata);

	if (rv != WALK_NEXT)
		return (rv);

	/*
	 * Figure out the type of this frame.
	 */
	if (read_heap_ptr(&ftype, addr, V8_OFF_FP_MARKER) != 0)
		return (WALK_ERR);

	if ((ftype & V8_SmiTagMask) == V8_SmiTag && V8_SMI_VALUE(ftype) == 0)
		return (WALK_DONE);

	if (mdb_vread(&next, sizeof (next), addr) == -1)
		return (WALK_ERR);

	wsp->walk_addr = next;
	return (WALK_NEXT);
}

/*
 * MDB linkage
 */

const mdb_dcmd_t v8_mdb_dcmds[] = {
	{ "jsclasses", NULL, "list known V8 heap object C++ classes",
		dcmd_jsclasses },
	{ "jsframe", ":[-v]", "summarize a V8 JS stack frame", dcmd_jsframe },
	{ "jsprint", ":[class]", "print a V8 heap object",
		dcmd_jsprint, dcmd_help_jsprint },
	{ "jsstack", "[-v]", "print a V8 stacktrace", dcmd_jsstack },
	{ "jsstr", ":[-v]", "print the contents of a V8 string", dcmd_jsstr },
	{ "jstype", ":", "print the type of a V8 heap object", dcmd_jstype },
	{ "jstypes", NULL, "list known V8 heap object types", dcmd_jstypes },
	{ "jsvals", NULL, "list known V8 heap special values", dcmd_jsvals },
	{ NULL }
};

const mdb_walker_t v8_mdb_walkers[] = {
	{ "jsframe", "walk V8 JavaScript stack frames",
		walk_jsframes_init, walk_jsframes_step },
	{ NULL }
};

mdb_modinfo_t v8_mdb = {
	.mi_dvers = MDB_API_VERSION,
	.mi_dcmds = v8_mdb_dcmds,
	.mi_walkers = v8_mdb_walkers
};

const mdb_modinfo_t *
_mdb_init(void)
{
	init_classes();
	init_enum(v8_types);
	init_enum(v8_frametypes);
	init_specials();
	return (&v8_mdb);
}

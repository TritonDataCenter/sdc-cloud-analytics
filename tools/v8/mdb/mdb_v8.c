/*
 * mdb(1M) module for debugging the V8 JavaScript engine.  This implementation
 * assumes 32-bit x86.
 */

#include <assert.h>
#include <string.h>

#include <sys/mdb_modapi.h>

/*
 * XXX These should be here, but the corresponding headers need guards.
 *	#include "heap-dbg-common.h"
 *	#include "heap-dbg-constants.h"
 */
#include "heap-dbg-inl.h"

/* XXX change these to use the common ones */
#define	V8_OFF_FUNC_FUNCINFO		V8_OFF_HEAP(0x14)

#define	V8_OFF_FUNCINFO_NAME		V8_OFF_HEAP(0x4)
#define	V8_OFF_FUNCINFO_SCRIPT		V8_OFF_HEAP(0x1c)
#define	V8_OFF_FUNCINFO_FUNCTOKPOS	V8_OFF_HEAP(0x4c)

#define	V8_OFF_SCRIPT_NAME		V8_OFF_HEAP(0x8)
#define	V8_OFF_SCRIPT_LINEENDS		V8_OFF_HEAP(0x28)

#define	V8_OFF_MAP_INSTANCEATTRS	V8_OFF_HEAP(0x8)

#define	V8_OFF_FIXEDARRAY_SIZE		V8_OFF_HEAP(0x4)
#define	V8_OFF_FIXEDARRAY_DATA		V8_OFF_HEAP(0x8)

#define	V8_OFF_STRING_LENGTH		V8_OFF_HEAP(0x4)
#define	V8_OFF_SEQSTRING_CHARS		V8_OFF_HEAP(0xc)
#define	V8_OFF_CONSSTRING_CAR		V8_OFF_HEAP(0xc)
#define	V8_OFF_CONSSTRING_CDR		V8_OFF_HEAP(0x10)

/*
 * Describes the V8 "InstanceType" enum values that do NOT represent string
 * types.  String types (having value less than 0x80) are determined
 * programmatically.
 * XXX should be auto-generated.
 */
typedef struct {
	const char 	*v8t_name;	/* type name */
	uint_t		v8t_type;	/* actual type value */
} v8_instance_type_t;

static v8_instance_type_t v8_types[] = {
	{ "Map", 			V8_TYPE_NOTSTRING	},
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
 * For convenience, we allow the offset to be omitted for fields specified
 * above.  We fill in the true offset here as well as the "end" field.
 * XXX will be removed when we actually encode offsets in generated code
 */
static void
init_classes(void)
{
	v8_class_t *clp;
	v8_field_t *flp;
	int ii;

	for (ii = 0; ii < v8_nclasses; ii++) {
		clp = v8_classes[ii];

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
 * the InstanceType enum above.  We fill in the true values here using the same
 * rules as for standard C enum definitions.
 * XXX will be removed when this becomes auto-generated
 */
static void
init_types(void)
{
	v8_instance_type_t *itp;
	uint8_t val = 0;

	for (itp = v8_types; itp->v8t_name != NULL; itp++) {
		if (itp->v8t_type == 0)
			itp->v8t_type = val;

		val = itp->v8t_type + 1;
	}
}

/*
 * Utility functions
 */
static int print_strval(uintptr_t, boolean_t);

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

	/*
	 * Recall that V8 stores small integers on the heap using the upper 31
	 * bits, so we must shift the word over to get the true value.  The
	 * low-order bit must be clear if this is really an SMI.
	 */
	if ((*valp & V8_MASK_SMI_TAG) != 0) {
		mdb_warn("expected SMI, got %p", *valp);
		return (-1);
	}

	*valp >>= 1;
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

	if ((mapaddr & V8_MASK_HEAPOBJECT_TAG) != V8_TAG_HEAPOBJECT) {
		mdb_warn("heap object map is not itself a heap object\n");
		return (-1);
	}

	if (mdb_vread(valp, sizeof (*valp),
	    mapaddr + V8_OFF_MAP_INSTANCEATTRS) != sizeof (*valp)) {
		mdb_warn("failed to read type byte");
		return (-1);
	}

	return (0);
}

/*
 * Returns in "buf" a description of the type of "addr".
 */
static int
obj_jstype(uintptr_t addr, char *buf, size_t len, uint8_t *typep)
{
	uint8_t typebyte;
	v8_instance_type_t *itp;

	buf[0] = '\0';

	if ((addr & V8_MASK_HEAPOBJECT_TAG) == V8_TAG_FAILURE) {
		if (typep)
			*typep = 0;
		(void) mdb_snprintf(buf, len, "'Failure' object");
		return (0);
	}

	if ((addr & V8_MASK_SMI_TAG) == 0) {
		if (typep)
			*typep = 0;
		(void) mdb_snprintf(buf, len, "SMI: value = %d", addr >> 1);
		return (0);
	}

	if (read_typebyte(&typebyte, addr) != 0)
		return (-1);

	if (typep)
		*typep = typebyte;

	if ((typebyte & V8_TYPE_NOTSTRING) != 0) {
		for (itp = v8_types; itp->v8t_name != NULL; itp++) {
			if (itp->v8t_type == typebyte) {
				(void) strlcpy(buf, itp->v8t_name, len);
				return (DCMD_OK);
			}
		}

		(void) mdb_snprintf(buf, len, "unknown type 0x%x",
		    itp->v8t_type);
		return (0);
	}

	(void) strlcpy(buf, (typebyte & V8_MASK_STRENC) == V8_TAG_STRENC_ASCII ?
	    "ascii " : "two-byte ", len);

	switch (typebyte & V8_MASK_STRREP) {
	case V8_TAG_STRREP_SEQ:
		(void) strlcat(buf, "SeqString", len);
		break;
	case V8_TAG_STRREP_CONS:
		(void) strlcat(buf, "ConsString", len);
		break;
	case V8_TAG_STRREP_EXT:
		(void) strlcat(buf, "ExternalString", len);
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
	char buf[64];
	uint8_t type;

	for (flp = clp->v8c_fields; flp->v8f_name != NULL; flp++) {
		addr = baddr + flp->v8f_offset;
		assert(flp->v8f_size == sizeof (uintptr_t));
		rv = mdb_vread((void *)&value, sizeof (value), addr);

		if (rv != sizeof (value) ||
		    obj_jstype(value, buf, sizeof (buf), &type) != 0) {
			mdb_printf("%p %s (unreadable)\n", addr, flp->v8f_name);
			continue;
		}

		mdb_printf("%p %s = %p (%s", addr, flp->v8f_name,
		    value, buf);

		if (type != 0 && (type & V8_TYPE_NOTSTRING) == 0) {
			mdb_printf(": \"");
			print_strval(value, B_FALSE);
			mdb_printf("\"");
		}

		mdb_printf(")\n");
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
print_strval(uintptr_t addr, boolean_t verbose)
{
	uint8_t typebyte;
	uintptr_t len, rlen, ptr1, ptr2;
	int err = 0;
	char buf[256];

	if (read_typebyte(&typebyte, addr) != 0)
		return (0);

	if ((typebyte & V8_TYPE_NOTSTRING) != 0) {
		mdb_printf("<invalid string>");
		return (0);
	}

	if ((typebyte & V8_MASK_STRENC) != V8_TAG_STRENC_ASCII) {
		mdb_printf("<two-byte string>");
		return (0);
	}

	if (verbose) {
		(void) obj_jstype(addr, buf, sizeof (buf), NULL);
		mdb_printf("%s\n", buf);
		(void) mdb_inc_indent(4);
	}

	switch (typebyte & V8_MASK_STRREP) {
	case V8_TAG_STRREP_SEQ:
		err |= read_heap_smi(&len, addr, V8_OFF_STRING_LENGTH);

		if (err != 0)
			break;

		rlen = len <= sizeof (buf) - 1 ? len :
		    sizeof (buf) - sizeof ("[...]");

		if (verbose) {
			mdb_printf("length: %d\n", len);
			mdb_printf("will read: %d\n", rlen);
		}

		if (rlen > 0 && mdb_vread(&buf, rlen,
		    addr + V8_OFF_SEQSTRING_CHARS) != rlen) {
			mdb_warn("failed to read SeqString data");
			err = -1;
			break;
		}

		buf[rlen] = '\0';

		if (rlen != len)
			(void) strlcat(buf, "[...]", sizeof (buf));

		if (verbose)
			mdb_printf("value: \"");

		mdb_printf("%s", buf);

		if (verbose)
			mdb_printf("\"\n");

		break;

	case V8_TAG_STRREP_CONS:
		err |= read_heap_ptr(&ptr1, addr, V8_OFF_CONSSTRING_CAR);
		err |= read_heap_ptr(&ptr2, addr, V8_OFF_CONSSTRING_CDR);

		if (err == 0) {
			if (verbose) {
				mdb_printf("ptr1: %p\n", ptr1);
				mdb_printf("ptr2: %p\n", ptr2);
			}

			err |= print_strval(ptr1, verbose);
		}

		if (err == 0)
			err |= print_strval(ptr2, verbose);

		break;

	case V8_TAG_STRREP_EXT:
		mdb_printf("<ExternalString>");
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
func_line(uintptr_t lendsp, uintptr_t tokpos, char *buf, size_t buflen)
{
	uintptr_t size, bufsz, lower, upper, ii;
	uintptr_t *data;

	if (read_heap_smi(&size, lendsp, V8_OFF_FIXEDARRAY_SIZE) != 0)
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

/*
 * dcmd implementations
 */

/* ARGSUSED */
int
dcmd_jsprint(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	const char *rqclass;
	v8_class_t *clp;
	int ii;

	if (argc < 1 || argv[0].a_type != MDB_TYPE_STRING)
		return (DCMD_USAGE);

	rqclass = argv[0].a_un.a_str;
	for (ii = 0; ii < v8_nclasses; ii++) {
		clp = v8_classes[ii];
		if (strcmp(rqclass, clp->v8c_name) == 0)
			break;
	}

	if (ii == v8_nclasses) {
		mdb_printf("error: don't know about class '%s'\n", rqclass);
		mdb_printf("available classes:\n");
		(void) mdb_inc_indent(4);
		for (ii = 0; ii < v8_nclasses; ii++) {
			clp = v8_classes[ii];
			mdb_printf("%s\n", clp->v8c_name);
		}
		(void) mdb_dec_indent(4);
		return (DCMD_USAGE);
	}

	return (obj_print_class(addr, clp));
}

/* ARGSUSED */
static int
dcmd_jstypes(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	v8_instance_type_t *itp;

	for (itp = v8_types; itp->v8t_name != NULL; itp++)
		mdb_printf("%-30s = 0x%02x\n", itp->v8t_name, itp->v8t_type);

	return (DCMD_OK);
}

/* ARGSUSED */
static int
dcmd_jstype(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	char buf[64];

	if (obj_jstype(addr, buf, sizeof (buf), NULL) != 0)
		return (DCMD_ERR);

	mdb_printf("0x%p: %s\n", addr, buf);
	return (DCMD_OK);
}

/* ARGSUSED */
static int
dcmd_jsframe(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	uintptr_t funcp, funcinfop, tokpos, scriptp, lendsp, ptrp;
	boolean_t opt_v = B_FALSE;
	char typebuf[64];

	if (mdb_getopts(argc, argv, 'v', MDB_OPT_SETBITS, B_TRUE, &opt_v,
	    NULL) != argc)
		return (DCMD_USAGE);

	if (opt_v)
		mdb_printf("frame pointer: ");
	mdb_printf("%p", addr);
	if (opt_v)
		mdb_printf("\n");

	if (read_heap_ptr(&funcp, addr, V8_OFF_FP_FUNCTION) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);
		(void) obj_jstype(funcp, typebuf, sizeof (typebuf), NULL);
		mdb_printf("function: %p (%s)\n", funcp, typebuf);
	}

	if (read_heap_ptr(&funcinfop, funcp, V8_OFF_FUNC_FUNCINFO) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);
		(void) obj_jstype(funcinfop, typebuf, sizeof (typebuf), NULL);
		mdb_printf("shared function info: %p (%s)\n", funcinfop,
		    typebuf);
	}

	if (read_heap_ptr(&ptrp, funcinfop, V8_OFF_FUNCINFO_NAME) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);
		(void) obj_jstype(ptrp, typebuf, sizeof (typebuf), NULL);
		mdb_printf("function name: %p (%s: \"", ptrp, typebuf);
		(void) print_strval(ptrp, B_FALSE);
		mdb_printf("\")\n");
	} else {
		mdb_printf(" function \"");
		(void) print_strval(ptrp, B_FALSE);
		mdb_printf("\"");
	}

	/*
	 * Although the token position is technically an SMI, we're going to
	 * byte-compare it to other SMI values so we don't want decode it here.
	 */
	if (read_heap_ptr(&tokpos, funcinfop, V8_OFF_FUNCINFO_FUNCTOKPOS) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) obj_jstype(tokpos, typebuf, sizeof (typebuf), NULL);
		mdb_printf("function token position: %s\n", typebuf);
	}

	if (read_heap_ptr(&scriptp, funcinfop, V8_OFF_FUNCINFO_SCRIPT) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) obj_jstype(scriptp, typebuf, sizeof (typebuf), NULL);
		mdb_printf("script: %p (%s)\n", scriptp, typebuf);
	}

	if (read_heap_ptr(&ptrp, scriptp, V8_OFF_SCRIPT_NAME) != 0)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);
		(void) obj_jstype(ptrp, typebuf, sizeof (typebuf), NULL);
		mdb_printf("script name: %p (%s: \"", ptrp, typebuf);
		(void) print_strval(ptrp, B_FALSE);
		mdb_printf("\")\n");
	} else {
		mdb_printf(" defined at ");
		(void) print_strval(ptrp, B_FALSE);
		mdb_printf(" ");
	}

	if (read_heap_ptr(&lendsp, scriptp, V8_OFF_SCRIPT_LINEENDS) != 0)
		return (DCMD_ERR);

	/* XXX compare to "undefined" */
	if (opt_v) {
		(void) obj_jstype(lendsp, typebuf, sizeof (typebuf), NULL);
		mdb_printf("line endings: %p (%s)\n", lendsp, typebuf);

		(void) mdb_dec_indent(4);
		mdb_printf("function token at: ");
	}

	(void) func_line(lendsp, tokpos, typebuf, sizeof (typebuf));
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
	mdb_tid_t tid = 1; /* assume JS thread is always tid 1 */
	mdb_reg_t reg;
	uintptr_t ebp, retp;
	int left = 20;

	mdb_printf("thread %d\n", tid);
	(void) mdb_inc_indent(4);

	if (mdb_getareg(tid, "ebp", &reg) != 0) {
		mdb_warn("failed to read ebp for thread %d", tid);
		return (DCMD_ERR);
	}

	ebp = (uintptr_t)reg;

	while (ebp != NULL && left-- > 0) {
		(void) mdb_call_dcmd("jsframe", ebp, DCMD_ADDRSPEC, 0, NULL);

		if (mdb_vread(&retp, sizeof (retp), ebp + sizeof (ebp)) !=
		    sizeof (retp) || retp == 0 ||
		    mdb_vread(&ebp, sizeof (ebp), ebp) != sizeof (ebp))
			break;
	}

	(void) mdb_dec_indent(4);

	return (DCMD_OK);
}

/* ARGSUSED */
static int
dcmd_jsstr(uintptr_t addr, uint_t flags, int argc, const mdb_arg_t *argv)
{
	boolean_t opt_v = B_FALSE;

	if (mdb_getopts(argc, argv, 'v', MDB_OPT_SETBITS, B_TRUE, &opt_v,
	    NULL) != argc)
		return (DCMD_USAGE);

	return (print_strval(addr, opt_v) == 0 ? DCMD_OK : DCMD_ERR);
}

/*
 * MDB linkage
 */

const mdb_dcmd_t v8_mdb_dcmds[] = {
	{ "jsframe", ":",	"print a V8 stack frame", dcmd_jsframe },
	{ "jsprint", ": class",	"print a V8 heap object", dcmd_jsprint },
	{ "jsstack", ":[-v]",	"print a V8 stacktrace", dcmd_jsstack },
	{ "jsstr", ":[-v]",	"print a V8 string", dcmd_jsstr },
	{ "jstype", ":", "print the type of a V8 heap object", dcmd_jstype },
	{ "jstypes", "", "print all V8 heap object types", dcmd_jstypes },
	{ NULL }
};

const mdb_walker_t v8_mdb_walkers[] = {
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
	init_types();
	return (&v8_mdb);
}

/*
 * mdb(1M) module for debugging the V8 JavaScript engine.  This implementation
 * makes heavy use of metadata defined in the V8 binary for inspecting in-memory
 * structures.
 */

#include <assert.h>
#include <ctype.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include <sys/mdb_modapi.h>

#include "v8dbg.h"

/*
 * The "v8_class" and "v8_field" structures describe the C++ classes used to
 * represent V8 heap objects.
 */
typedef struct v8_class {
	struct v8_class *v8c_next;	/* list linkage */
	struct v8_class *v8c_parent;	/* parent class (inheritance) */
	struct v8_field *v8c_fields;	/* array of class fields */
	size_t		v8c_start;	/* offset of first class field */
	size_t		v8c_end;	/* offset of first subclass field */
	char		v8c_name[64];	/* heap object class name */
} v8_class_t;

typedef struct v8_field {
	struct v8_field	*v8f_next;	/* list linkage */
	ssize_t		v8f_offset;	/* field offset */
	char 		v8f_name[64];	/* field name */
} v8_field_t;

/*
 * Similarly, the "v8_enum" structure describes an enum from V8.
 */
typedef struct {
	char 	v8e_name[64];
	uint_t	v8e_value;
} v8_enum_t;

/*
 * During configuration, the dmod updates these globals with the actual set of
 * classes, types, and frame types based on metadata in the target binary.
 */
static v8_class_t	*v8_classes;

static v8_enum_t	v8_types[128];
static int 		v8_next_type;

static v8_enum_t 	v8_frametypes[16];
static int 		v8_next_frametype;

/*
 * The following constants describe offsets from the frame pointer that are used
 * to inspect each stack frame.  They're initialized from metadata in the target
 * binary.
 */
static ssize_t	V8_OFF_FP_CONTEXT;
static ssize_t	V8_OFF_FP_MARKER;
static ssize_t	V8_OFF_FP_FUNCTION;

/*
 * The following constants are used by macros defined in heap-dbg-common.h to
 * examine the types of various V8 heap objects.  In general, the macros should
 * be preferred to using the constants directly.  The values of these constants
 * are initialized from metadata in the target binary.
 */
static int	V8_FirstNonstringType;
static int	V8_IsNotStringMask;
static int	V8_StringTag;
static int	V8_NotStringTag;
static int	V8_StringEncodingMask;
static int	V8_TwoByteStringTag;
static int	V8_AsciiStringTag;
static int	V8_StringRepresentationMask;
static int	V8_SeqStringTag;
static int	V8_ConsStringTag;
static int	V8_ExternalStringTag;
static int	V8_FailureTag;
static int	V8_FailureTagMask;
static int	V8_HeapObjectTag;
static int	V8_HeapObjectTagMask;
static int	V8_SmiTag;
static int	V8_SmiTagMask;
static int	V8_SmiValueShift;

/*
 * Although we have this information in v8_classes, the following offsets are
 * defined explicitly because they're used directly in code below.
 */
static ssize_t	V8_OFF_FIXEDARRAY_DATA;
static ssize_t	V8_OFF_MAP_ATTRS;
static ssize_t	V8_OFF_ODDBALL_STR;
static ssize_t	V8_OFF_SEQASCIISTR_CHARS;

#define	NODE_OFF_EXTSTR_DATA		0x4	/* see node_string.h */

/*
 * Table of constants used directly by this file.
 */
typedef struct v8_constant {
	int		*v8c_valp;
	const char	*v8c_symbol;
} v8_constant_t;

static v8_constant_t v8_constants[] = {
	{ &V8_OFF_FP_CONTEXT,		"v8dbg_off_fp_context"		},
	{ &V8_OFF_FP_FUNCTION,		"v8dbg_off_fp_function"		},
	{ &V8_OFF_FP_MARKER,		"v8dbg_off_fp_marker"		},
	{ &V8_FirstNonstringType,	"v8dbg_FirstNonstringType"	},
	{ &V8_IsNotStringMask,		"v8dbg_IsNotStringMask"		},
	{ &V8_StringTag,		"v8dbg_StringTag"		},
	{ &V8_NotStringTag,		"v8dbg_NotStringTag"		},
	{ &V8_StringEncodingMask,	"v8dbg_StringEncodingMask"	},
	{ &V8_TwoByteStringTag,		"v8dbg_TwoByteStringTag"	},
	{ &V8_AsciiStringTag,		"v8dbg_AsciiStringTag"		},
	{ &V8_StringRepresentationMask,	"v8dbg_StringRepresentationMask" },
	{ &V8_SeqStringTag,		"v8dbg_SeqStringTag"		},
	{ &V8_ConsStringTag,		"v8dbg_ConsStringTag"		},
	{ &V8_ExternalStringTag,	"v8dbg_ExternalStringTag"	},
	{ &V8_FailureTag,		"v8dbg_FailureTag"		},
	{ &V8_FailureTagMask,		"v8dbg_FailureTagMask"		},
	{ &V8_HeapObjectTag,		"v8dbg_HeapObjectTag"		},
	{ &V8_HeapObjectTagMask,	"v8dbg_HeapObjectTagMask"	},
	{ &V8_SmiTag,			"v8dbg_SmiTag"			},
	{ &V8_SmiTagMask,		"v8dbg_SmiTagMask"		},
	{ &V8_SmiValueShift,		"v8dbg_SmiValueShift"		},
};

static int v8_nconstants = sizeof (v8_constants) / sizeof (v8_constants[0]);

static int autoconf_iter_symbol(mdb_symbol_t *, void *);
static v8_class_t *conf_class_findcreate(const char *);
static v8_field_t *conf_field_create(v8_class_t *, const char *, size_t);
static char *conf_next_part(char *, char *);
static int conf_update_parent(const char *);
static int conf_update_field(const char *);
static int conf_update_enum(const char *, const char *, v8_enum_t *);
static int conf_update_type(const char *);
static int conf_update_frametype(const char *);
static void conf_class_compute_offsets(v8_class_t *);

static int heap_offset(const char *, const char *, ssize_t *);

/*
 * Invoked when this dmod is initially loaded to load the set of classes, enums,
 * and other constants from the metadata in the target binary.
 */
static int
autoconfigure(void)
{
	v8_class_t *clp;
	GElf_Sym sym;
	struct v8_constant *cnp;
	int ii;

	assert(v8_classes == NULL);

	/*
	 * Do a quick check first to see if we might support this binary.
	 */
	if (mdb_lookup_by_name("v8dbg_SmiTag", &sym) != 0)
		return (-1);

	/*
	 * Now iterate all global symbols looking for metadata.
	 */
	if (mdb_symbol_iter(MDB_OBJ_EVERY, MDB_SYMTAB,
	    MDB_BIND_GLOBAL | MDB_TYPE_OBJECT | MDB_TYPE_FUNC,
	    autoconf_iter_symbol, NULL) != 0) {
		mdb_warn("failed to autoconfigure V8 support\n");
		return (-1);
	}

	/*
	 * By now we've configured all of the classes so we can update the
	 * "start" and "end" fields in each class with information from its
	 * parent class.
	 */
	for (clp = v8_classes; clp != NULL; clp = clp->v8c_next) {
		if (clp->v8c_end != (size_t)-1)
			continue;

		conf_class_compute_offsets(clp);
	};

	/*
	 * Finally, load various constants used directly in the module.
	 */
	for (ii = 0; ii < v8_nconstants; ii++) {
		cnp = &v8_constants[ii];

		if (mdb_readsym(cnp->v8c_valp, sizeof (*cnp->v8c_valp),
		    cnp->v8c_symbol) == -1) {
			mdb_warn("failed to read \"%s\"", cnp->v8c_symbol);
			return (-1);
		}
	}

	if (heap_offset("Map", "instance_attributes", &V8_OFF_MAP_ATTRS) != 0 ||
	    heap_offset("SeqAsciiString", "chars",
	    &V8_OFF_SEQASCIISTR_CHARS) != 0 ||
	    heap_offset("FixedArray", "data", &V8_OFF_FIXEDARRAY_DATA) != 0 ||
	    heap_offset("Oddball", "to_string", &V8_OFF_ODDBALL_STR) != 0)
		return (-1);

	mdb_printf("Loaded V8 support.\n");
	return (0);
}

/* ARGSUSED */
static int
autoconf_iter_symbol(mdb_symbol_t *symp, void *unused)
{
	if (strncmp(symp->sym_name, "v8dbg_parent_",
	    sizeof ("v8dbg_parent_") - 1) == 0)
		return (conf_update_parent(symp->sym_name));

	if (strncmp(symp->sym_name, "v8dbg_class_",
	    sizeof ("v8dbg_class_") - 1) == 0)
		return (conf_update_field(symp->sym_name));

	if (strncmp(symp->sym_name, "v8dbg_type_",
	    sizeof ("v8dbg_type_") - 1) == 0)
		return (conf_update_type(symp->sym_name));

	if (strncmp(symp->sym_name, "v8dbg_frametype_",
	    sizeof ("v8dbg_frametype_") - 1) == 0)
		return (conf_update_frametype(symp->sym_name));

	return (0);
}

/*
 * Extracts the next field of a string whose fields are separated by "__" (as
 * the V8 metadata symbols are).
 */
static char *
conf_next_part(char *buf, char *start)
{
	char *pp;

	if ((pp = strstr(start, "__")) == NULL) {
		mdb_warn("malformed symbol name: %s\n", buf);
		return (NULL);
	}

	*pp = '\0';
	return (pp + sizeof ("__") - 1);
}

static v8_class_t *
conf_class_findcreate(const char *name)
{
	v8_class_t *clp, *iclp, **ptr;
	int cmp;

	if (v8_classes == NULL || strcmp(v8_classes->v8c_name, name) > 0) {
		ptr = &v8_classes;
	} else {
		for (iclp = v8_classes; iclp->v8c_next != NULL;
		    iclp = iclp->v8c_next) {
			cmp = strcmp(iclp->v8c_next->v8c_name, name);

			if (cmp == 0)
				return (iclp->v8c_next);

			if (cmp > 0)
				break;
		}

		ptr = &iclp->v8c_next;
	}

	if ((clp = mdb_zalloc(sizeof (*clp), UM_NOSLEEP)) == NULL)
		return (NULL);

	(void) strlcpy(clp->v8c_name, name, sizeof (clp->v8c_name));
	clp->v8c_end = (size_t)-1;

	clp->v8c_next = *ptr;
	*ptr = clp;
	return (clp);
}

static v8_field_t *
conf_field_create(v8_class_t *clp, const char *name, size_t offset)
{
	v8_field_t *flp, *iflp;

	if ((flp = mdb_zalloc(sizeof (*flp), UM_NOSLEEP)) == NULL)
		return (NULL);

	(void) strlcpy(flp->v8f_name, name, sizeof (flp->v8f_name));
	flp->v8f_offset = offset;

	if (clp->v8c_fields == NULL ||
	    strcmp(clp->v8c_fields->v8f_name, name) > 0) {
		flp->v8f_next = clp->v8c_fields;
		clp->v8c_fields = flp;
		return (flp);
	}

	for (iflp = clp->v8c_fields; iflp->v8f_next != NULL;
	    iflp = iflp->v8f_next) {
		if (strcmp(iflp->v8f_next->v8f_name, name) > 0)
			break;
	}

	flp->v8f_next = iflp->v8f_next;
	iflp->v8f_next = flp;
	return (flp);
}

/*
 * Given a "v8dbg_parent_X__Y", symbol, update the parent of class X to class Y.
 * Note that neither class necessarily exists already.
 */
static int
conf_update_parent(const char *symbol)
{
	char *pp, *qq;
	char buf[128];
	v8_class_t *clp, *pclp;

	(void) strlcpy(buf, symbol, sizeof (buf));
	pp = buf + sizeof ("v8dbg_parent_") - 1;
	qq = conf_next_part(buf, pp);

	if (qq == NULL)
		return (-1);

	clp = conf_class_findcreate(pp);
	pclp = conf_class_findcreate(qq);

	if (clp == NULL || pclp == NULL) {
		mdb_warn("mdb_v8: out of memory\n");
		return (-1);
	}

	clp->v8c_parent = pclp;
	return (0);
}

/*
 * Given a "v8dbg_class_CLASS__FIELD__TYPE", symbol, save field "FIELD" into
 * class CLASS with the offset described by the symbol.  Note that CLASS does
 * not necessarily exist already.
 */
static int
conf_update_field(const char *symbol)
{
	v8_class_t *clp;
	size_t offset;
	char *pp, *qq;
	char buf[128];

	(void) strlcpy(buf, symbol, sizeof (buf));

	pp = buf + sizeof ("v8dbg_class_") - 1;
	qq = conf_next_part(buf, pp);

	if (qq == NULL || conf_next_part(buf, qq) == NULL)
		return (-1);

	if (mdb_readsym(&offset, sizeof (offset), symbol) == -1) {
		mdb_warn("failed to read symbol \"%s\"", symbol);
		return (-1);
	}

	if ((clp = conf_class_findcreate(pp)) == NULL ||
	    conf_field_create(clp, qq, offset) == NULL)
		return (-1);

	return (0);
}

static int
conf_update_enum(const char *symbol, const char *name, v8_enum_t *enp)
{
	int value;

	if (mdb_readsym(&value, sizeof (value), symbol) == -1) {
		mdb_warn("failed to read symbol \"%s\"", symbol);
		return (-1);
	}

	enp->v8e_value = value;
	(void) strlcpy(enp->v8e_name, name, sizeof (enp->v8e_name));
	return (0);
}

/*
 * Given a "v8dbg_type_TYPENAME" constant, save the type name in v8_types.  Note
 * that this enum has multiple integer values with the same string label.
 */
static int
conf_update_type(const char *symbol)
{
	char *klass;
	v8_enum_t *enp;
	char buf[128];

	if (v8_next_type > sizeof (v8_types) / sizeof (v8_types[0])) {
		mdb_warn("too many V8 types\n");
		return (-1);
	}

	(void) strlcpy(buf, symbol, sizeof (buf));

	klass = buf + sizeof ("v8dbg_type_") - 1;
	if (conf_next_part(buf, klass) == NULL)
		return (-1);

	enp = &v8_types[v8_next_type++];
	return (conf_update_enum(symbol, klass, enp));
}

/*
 * Given a "v8dbg_frametype_TYPENAME" constant, save the frame type in
 * v8_frametypes.
 */
static int
conf_update_frametype(const char *symbol)
{
	const char *frametype;
	v8_enum_t *enp;

	if (v8_next_frametype >
	    sizeof (v8_frametypes) / sizeof (v8_frametypes[0])) {
		mdb_warn("too many V8 frame types\n");
		return (-1);
	}

	enp = &v8_frametypes[v8_next_frametype++];
	frametype = symbol + sizeof ("v8dbg_frametype_") - 1;
	return (conf_update_enum(symbol, frametype, enp));
}

/*
 * Now that all classes have been loaded, update the "start" and "end" fields of
 * each class based on the values of its parent class.
 */
static void
conf_class_compute_offsets(v8_class_t *clp)
{
	v8_field_t *flp;

	assert(clp->v8c_start == 0);
	assert(clp->v8c_end == (size_t)-1);

	if (clp->v8c_parent != NULL) {
		if (clp->v8c_parent->v8c_end == (size_t)-1)
			conf_class_compute_offsets(clp->v8c_parent);

		clp->v8c_start = clp->v8c_parent->v8c_end;
	}

	if (clp->v8c_fields == NULL) {
		clp->v8c_end = clp->v8c_start;
		return;
	}

	for (flp = clp->v8c_fields; flp->v8f_next != NULL; flp = flp->v8f_next)
		;

	if (flp == NULL)
		clp->v8c_end = clp->v8c_start;
	else
		clp->v8c_end = flp->v8f_offset + sizeof (uintptr_t);
}

/*
 * Utility functions
 */
static int jsstr_print(uintptr_t, boolean_t, char **, size_t *);

static const char *
enum_lookup_str(v8_enum_t *enums, int val, const char *dflt)
{
	v8_enum_t *ep;

	for (ep = enums; ep->v8e_name[0] != '\0'; ep++) {
		if (ep->v8e_value == val)
			return (ep->v8e_name);
	}

	return (dflt);
}

static void
enum_print(v8_enum_t *enums)
{
	v8_enum_t *itp;

	for (itp = enums; itp->v8e_name[0] != '\0'; itp++)
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

/*
 * Returns in "offp" the offset of field "field" in C++ class "klass".
 */
static int
heap_offset(const char *klass, const char *field, ssize_t *offp)
{
	v8_class_t *clp;
	v8_field_t *flp;

	for (clp = v8_classes; clp != NULL; clp = clp->v8c_next) {
		if (strcmp(klass, clp->v8c_name) == 0)
			break;
	}

	if (clp == NULL) {
		mdb_warn("couldn't find class \"%s\"\n", klass);
		return (-1);
	}

	for (flp = clp->v8c_fields; flp != NULL; flp = flp->v8f_next) {
		if (strcmp(field, flp->v8f_name) == 0)
			break;
	}

	if (flp == NULL) {
		mdb_warn("couldn't find class \"%s\" field \"%s\"\n",
		    klass, field);
		return (-1);
	}

	*offp = V8_OFF_HEAP(flp->v8f_offset);
	return (0);
}

/*
 * Assuming "addr" is an instance of the C++ heap class "klass", read into *valp
 * the pointer-sized value of field "field".
 */
static int
read_heap_ptr(uintptr_t *valp, uintptr_t addr, const char *klass,
    const char *field)
{
	ssize_t off;

	if (heap_offset(klass, field, &off) != 0)
		return (-1);

	if (mdb_vread(valp, sizeof (*valp), addr + off) == -1) {
		mdb_warn("failed to read heap value at %p", addr + off);
		return (-1);
	}

	return (0);
}

/*
 * Like read_heap_ptr, but assume the field is an SMI and store the actual value
 * into *valp rather than the encoded representation.
 */
static int
read_heap_smi(uintptr_t *valp, uintptr_t addr, const char *klass,
    const char *field)
{
	if (read_heap_ptr(valp, addr, klass, field) != 0)
		return (-1);

	if (!V8_IS_SMI(*valp)) {
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

	if (read_heap_ptr(&mapaddr, addr, "HeapObject", "map") != 0)
		return (-1);

	if (!V8_IS_HEAPOBJECT(mapaddr)) {
		mdb_warn("heap object map is not itself a heap object\n");
		return (-1);
	}

	if (mdb_vread(valp, sizeof (*valp), mapaddr + V8_OFF_MAP_ATTRS) == -1) {
		mdb_warn("failed to read type byte");
		return (-1);
	}

	return (0);
}

/*
 * Returns in "buf" a description of the type of "addr" suitable for printing.
 */
static int
obj_jstype(uintptr_t addr, char **bufp, size_t *lenp, uint8_t *typep)
{
	uint8_t typebyte;
	uintptr_t strptr;
	const char *typename;

	if (V8_IS_FAILURE(addr)) {
		if (typep)
			*typep = 0;
		(void) bsnprintf(bufp, lenp, "'Failure' object");
		return (0);
	}

	if (V8_IS_SMI(addr)) {
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

	typename = enum_lookup_str(v8_types, typebyte, "<unknown>");
	(void) bsnprintf(bufp, lenp, typename);

	if (strcmp(typename, "Oddball") == 0) {
		if (mdb_vread(&strptr, sizeof (strptr),
		    addr + V8_OFF_ODDBALL_STR) == -1) {
			mdb_warn("failed to read oddball to_string");
		} else {
			(void) bsnprintf(bufp, lenp, ": \"");
			(void) jsstr_print(strptr, B_FALSE, bufp, lenp);
			(void) bsnprintf(bufp, lenp, "\"");
		}
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

	for (flp = clp->v8c_fields; flp != NULL; flp = flp->v8f_next) {
		bufp = buf;
		len = sizeof (buf);

		addr = baddr + V8_OFF_HEAP(flp->v8f_offset);
		rv = mdb_vread((void *)&value, sizeof (value), addr);

		if (rv != sizeof (value) ||
		    obj_jstype(value, &bufp, &len, &type) != 0) {
			mdb_printf("%p %s (unreadable)\n", addr, flp->v8f_name);
			continue;
		}

		if (type != 0 && V8_TYPE_STRING(type)) {
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
static int jsstr_print_seq(uintptr_t, boolean_t, char **, size_t *);
static int jsstr_print_cons(uintptr_t, boolean_t, char **, size_t *);
static int jsstr_print_external(uintptr_t, boolean_t, char **, size_t *);

static int
jsstr_print(uintptr_t addr, boolean_t verbose, char **bufp, size_t *lenp)
{
	uint8_t typebyte;
	int err = 0;
	char *lbufp;
	size_t llen;
	char buf[64];

	if (read_typebyte(&typebyte, addr) != 0)
		return (0);

	if (!V8_TYPE_STRING(typebyte)) {
		(void) bsnprintf(bufp, lenp, "<not a string>");
		return (0);
	}

	if (!V8_STRENC_ASCII(typebyte)) {
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

	if (V8_STRREP_SEQ(typebyte))
		err = jsstr_print_seq(addr, verbose, bufp, lenp);
	else if (V8_STRREP_CONS(typebyte))
		err = jsstr_print_cons(addr, verbose, bufp, lenp);
	else if (V8_STRREP_EXT(typebyte))
		err = jsstr_print_external(addr, verbose, bufp, lenp);
	else {
		(void) bsnprintf(bufp, lenp, "<unknown string type>");
		err = -1;
	}

	if (verbose)
		(void) mdb_dec_indent(4);

	return (err);
}

static int
jsstr_print_seq(uintptr_t addr, boolean_t verbose, char **bufp, size_t *lenp)
{
	uintptr_t len, rlen;
	char buf[256];

	if (read_heap_smi(&len, addr, "String", "length") != 0)
		return (-1);

	rlen = len <= sizeof (buf) - 1 ? len : sizeof (buf) - sizeof ("[...]");

	if (verbose)
		mdb_printf("length: %d, will read: %d\n", len, rlen);

	buf[0] = '\0';

	if (rlen > 0 && mdb_readstr(buf, rlen + 1,
	    addr + V8_OFF_SEQASCIISTR_CHARS) == -1) {
		mdb_warn("failed to read SeqString data");
		return (-1);
	}

	if (rlen != len)
		(void) strlcat(buf, "[...]", sizeof (buf));

	if (verbose)
		mdb_printf("value: \"%s\"\n", buf);

	(void) bsnprintf(bufp, lenp, "%s", buf);
	return (0);
}

static int
jsstr_print_cons(uintptr_t addr, boolean_t verbose, char **bufp, size_t *lenp)
{
	uintptr_t ptr1, ptr2;

	if (read_heap_ptr(&ptr1, addr, "ConsString", "first") != 0 ||
	    read_heap_ptr(&ptr2, addr, "ConsString", "second") != 0)
		return (-1);

	if (verbose) {
		mdb_printf("ptr1: %p\n", ptr1);
		mdb_printf("ptr2: %p\n", ptr2);
	}

	if (jsstr_print(ptr1, verbose, bufp, lenp) != 0)
		return (-1);

	return (jsstr_print(ptr2, verbose, bufp, lenp));
}

static int
jsstr_print_external(uintptr_t addr, boolean_t verbose, char **bufp,
    size_t *lenp)
{
	uintptr_t ptr1, ptr2;
	char buf[256];

	if (verbose)
		mdb_printf("assuming Node.js string\n");

	if (read_heap_ptr(&ptr1, addr, "ExternalString", "resource") != 0)
		return (-1);

	if (mdb_vread(&ptr2, sizeof (ptr2),
	    ptr1 + NODE_OFF_EXTSTR_DATA) == -1) {
		mdb_warn("failed to read node external pointer: %p",
		    ptr1 + NODE_OFF_EXTSTR_DATA);
		return (-1);
	}

	if (mdb_readstr(buf, sizeof (buf), ptr2) == -1) {
		mdb_warn("failed to read ExternalString data");
		return (-1);
	}

	if (buf[0] != '\0' && !isascii(buf[0])) {
		mdb_warn("failed to read ExternalString ascii data\n");
		return (-1);
	}

	(void) bsnprintf(bufp, lenp, "%s", buf);
	return (0);
}

/*
 * Returns true if the given address refers to the "undefined" object.  Returns
 * false on failure, since we shouldn't fail on the actual "undefined" value.
 */
static boolean_t
jsobj_is_undefined(uintptr_t addr)
{
	uint8_t type;
	uintptr_t strptr;
	const char *typename;
	char buf[16];
	char *bufp = buf;
	size_t len = sizeof (buf);

	if (read_typebyte(&type, addr) != 0)
		return (B_FALSE);

	typename = enum_lookup_str(v8_types, type, "<unknown>");
	if (strcmp(typename, "Oddball") != 0)
		return (B_FALSE);

	if (mdb_vread(&strptr, sizeof (strptr),
	    addr + V8_OFF_ODDBALL_STR) == -1)
		return (B_FALSE);

	if (jsstr_print(strptr, B_FALSE, &bufp, &len) != 0)
		return (B_FALSE);

	return (strcmp(buf, "undefined") == 0);
}

/*
 * Fill in "buf" with the line number of the given token position using the line
 * endings table in "lendsp".  If "lendsp" is undefined, use the token position
 * instead.
 */
static int
jsfunc_lineno(uintptr_t lendsp, uintptr_t tokpos, char *buf, size_t buflen)
{
	uintptr_t size, bufsz, lower, upper, ii;
	uintptr_t *data;

	if (jsobj_is_undefined(lendsp)) {
		mdb_snprintf(buf, buflen, "position %d", tokpos);
		return (0);
	}

	if (read_heap_smi(&size, lendsp, "FixedArrayBase", "length") != 0)
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
 * Given a SharedFunctionInfo object, return (in bufp) a name of the function
 * suitable for printing.
 */
static int
jsfunc_name(uintptr_t funcinfop, char **bufp, size_t *lenp)
{
	uintptr_t ptrp;
	char *bufs = *bufp;

	if (read_heap_ptr(&ptrp, funcinfop, "SharedFunctionInfo",
	    "name") != 0 || jsstr_print(ptrp, B_FALSE, bufp, lenp) != 0)
		return (-1);

	if (*bufp != bufs)
		return (0);

	if (read_heap_ptr(&ptrp, funcinfop, "SharedFunctionInfo",
	    "inferred_name") != 0) {
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
	v8_class_t *clp;

	for (clp = v8_classes; clp != NULL; clp = clp->v8c_next)
		mdb_printf("%s\n", clp->v8c_name);

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
	v8_class_t *clp;
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

		if ((rqclass = enum_lookup_str(v8_types, type, NULL)) == NULL) {
			mdb_warn("object has unknown type\n");
			return (DCMD_ERR);
		}
	} else {
		if (argv[0].a_type != MDB_TYPE_STRING)
			return (DCMD_USAGE);

		rqclass = argv[0].a_un.a_str;
	}

	for (clp = v8_classes; clp != NULL; clp = clp->v8c_next) {
		if (strcmp(rqclass, clp->v8c_name) == 0)
			break;
	}

	if (clp == NULL) {
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

	/*
	 * First figure out what kind of frame this is using the same algorithm
	 * as V8's ComputeType function.  We only print useful information for
	 * JavaScriptFrames.  Conveniently, most other frame types are indicated
	 * by the presence of a frame type identifier on the stack.  For
	 * ArgumentsAdaptorFrames, the type identifier is in the "context" slot,
	 * while for other frames the type identifier is in the "marker" slot.
	 * Like V8, we check for the AdaptorFrame first, then look for other
	 * types, and if we haven't found a frame type identifier then we assume
	 * we're looking at a JavaScriptFrame.
	 */
	if (mdb_vread(&ftype, sizeof (ftype), addr + V8_OFF_FP_CONTEXT) == -1)
		return (DCMD_ERR);

	if (!V8_IS_SMI(ftype) &&
	    mdb_vread(&ftype, sizeof (ftype), addr + V8_OFF_FP_MARKER) == -1)
		return (DCMD_ERR);

	if (V8_IS_SMI(ftype)) {
		mdb_printf(" <%s>\n",
		    enum_lookup_str(v8_frametypes, V8_SMI_VALUE(ftype),
		    "<unknown>"));
		return (DCMD_OK);
	}

	if (mdb_vread(&funcp, sizeof (funcp), addr + V8_OFF_FP_FUNCTION) == -1)
		return (DCMD_ERR);

	if (opt_v) {
		(void) mdb_inc_indent(4);
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(funcp, &bufp, &len, NULL);
		mdb_printf("function: %p (%s)\n", funcp, typebuf);
	}

	if (read_heap_ptr(&funcinfop, funcp, "JSFunction", "shared") != 0)
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

		if (read_heap_ptr(&ptrp, funcinfop, "SharedFunctionInfo",
		    "name") == 0) {
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
	    "SharedFunctionInfo", "function_token_position") != 0)
		return (DCMD_ERR);

	if (opt_v) {
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(tokpos, &bufp, &len, NULL);
		mdb_printf("function token position: %s\n", typebuf);
	}

	if (read_heap_ptr(&scriptp, funcinfop,
	    "SharedFunctionInfo", "script") != 0)
		return (DCMD_ERR);

	if (opt_v) {
		bufp = typebuf;
		len = sizeof (typebuf);
		(void) obj_jstype(scriptp, &bufp, &len, NULL);
		mdb_printf("script: %p (%s)\n", scriptp, typebuf);
	}

	if (read_heap_ptr(&ptrp, scriptp, "Script", "name") != 0)
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

	if (read_heap_ptr(&lendsp, scriptp, "Script", "line_ends") != 0)
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
	if (mdb_vread(&ftype, sizeof (ftype), addr + V8_OFF_FP_MARKER) == -1)
		return (WALK_ERR);

	if (V8_IS_SMI(ftype) && V8_SMI_VALUE(ftype) == 0)
		return (WALK_DONE);

	if (mdb_vread(&next, sizeof (next), addr) == -1)
		return (WALK_ERR);

	wsp->walk_addr = next;
	return (WALK_NEXT);
}

/*
 * MDB linkage
 */

static const mdb_dcmd_t v8_mdb_dcmds[] = {
	{ "jsclasses", NULL, "list known V8 heap object C++ classes",
		dcmd_jsclasses },
	{ "jsframe", ":[-v]", "summarize a V8 JS stack frame", dcmd_jsframe },
	{ "jsprint", ":[class]", "print a V8 heap object",
		dcmd_jsprint, dcmd_help_jsprint },
	{ "jsstack", "[-v]", "print a V8 stacktrace", dcmd_jsstack },
	{ "jsstr", ":[-v]", "print the contents of a V8 string", dcmd_jsstr },
	{ "jstype", ":", "print the type of a V8 heap object", dcmd_jstype },
	{ "jstypes", NULL, "list known V8 heap object types", dcmd_jstypes },
	{ NULL }
};

static const mdb_walker_t v8_mdb_walkers[] = {
	{ "jsframe", "walk V8 JavaScript stack frames",
		walk_jsframes_init, walk_jsframes_step },
	{ NULL }
};

static mdb_modinfo_t v8_mdb = {
	.mi_dvers = MDB_API_VERSION,
	.mi_dcmds = v8_mdb_dcmds,
	.mi_walkers = v8_mdb_walkers
};

const mdb_modinfo_t *
_mdb_init(void)
{
	(void) autoconfigure();
	return (&v8_mdb);
}

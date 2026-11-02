package compile

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
)

// Identity encodes diagram source the way Kroki does (https://docs.kroki.io/kroki/setup/encode-diagram/): UTF-8 text, zlib at the best level, then
// URL-safe base64 with padding. The result decodes with any zlib, so it can go in https://kroki.io/d2/svg/<identity>, and it is the same for the same text.
func Identity(source string) string {
	var b bytes.Buffer
	w, _ := zlib.NewWriterLevel(&b, zlib.BestCompression)
	_, _ = w.Write([]byte(source))
	_ = w.Close()
	return base64.URLEncoding.EncodeToString(b.Bytes())
}

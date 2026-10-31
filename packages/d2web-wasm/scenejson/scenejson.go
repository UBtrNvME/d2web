// Package scenejson encodes a D2 scene document as the versioned JSON of spec 0001 section 4.
//
// Every struct is a tagged object ({"$": "Rect", ...}) with its exported fields under the Go names, enums as numbers, colours as
// "rgba(r,g,b,a)" strings. The set of struct types is closed: an unlisted type is an error, never a silent drop, so a D2 upgrade that
// adds a primitive fails loudly here. Font bytes are not in the JSON; they are returned beside it so they can be transferred.
package scenejson

import (
	"encoding/json"
	"fmt"
	"image/color"
	"reflect"

	"github.com/d2lang/d2/d2renderers/d2scene"
)

// Version is the sceneVersion of the protocol; bump on any breaking change to the encoding.
const Version = 1

var allowed = func() map[reflect.Type]bool {
	m := map[reflect.Type]bool{}
	for _, v := range []any{
		d2scene.Document{}, d2scene.Node{}, d2scene.Box{}, d2scene.Bounds{}, d2scene.Point{}, d2scene.Matrix{},
		d2scene.Rect{}, d2scene.Ellipse{}, d2scene.Font{}, d2scene.Glyph{}, d2scene.TextRun{}, d2scene.AspectRatio{}, d2scene.Image{},
		d2scene.Path{}, d2scene.PathCommand{}, d2scene.CenterArc{},
		d2scene.SolidPaint{}, d2scene.GradientStop{}, d2scene.LinearGradient{}, d2scene.RadialGradient{}, d2scene.PatternPaint{}, d2scene.Stroke{},
		d2scene.FontAsset{}, d2scene.RasterAsset{}, d2scene.VectorAsset{}, d2scene.LinkRegion{},
		d2scene.Clip{}, d2scene.Mask{}, d2scene.GaussianBlur{}, d2scene.DropShadow{},
		d2scene.AnimationValue{}, d2scene.Easing{}, d2scene.Keyframe{}, d2scene.Track{},
	} {
		m[reflect.TypeOf(v)] = true
	}
	return m
}()

// Types lists the struct type names the encoder accepts, for the schema snapshot test.
func Types() []string {
	var names []string
	for t := range allowed {
		names = append(names, t.Name())
	}
	return names
}

// Encode returns the scene JSON and the font bytes by asset ID.
func Encode(doc *d2scene.Document) ([]byte, map[d2scene.AssetID][]byte, error) {
	if doc == nil || doc.Root == nil {
		return nil, nil, fmt.Errorf("scenejson: document and root are required")
	}
	fonts := map[d2scene.AssetID][]byte{}
	value, err := encode(reflect.ValueOf(doc), fonts, "")
	if err != nil {
		return nil, nil, err
	}
	out, err := json.Marshal(value)
	return out, fonts, err
}

func encode(v reflect.Value, fonts map[d2scene.AssetID][]byte, path string) (any, error) {
	switch v.Kind() {
	case reflect.Invalid:
		return nil, nil
	case reflect.Interface, reflect.Ptr:
		if v.IsNil() {
			return nil, nil
		}
		return encode(v.Elem(), fonts, path)
	case reflect.Struct:
		if c, ok := v.Interface().(color.NRGBA); ok {
			return fmt.Sprintf("rgba(%d,%d,%d,%.4f)", c.R, c.G, c.B, float64(c.A)/255), nil
		}
		if !allowed[v.Type()] {
			return nil, fmt.Errorf("scenejson: unsupported scene type %s at %s", v.Type(), path)
		}
		out := map[string]any{"$": v.Type().Name()}
		for i := 0; i < v.NumField(); i++ {
			field := v.Type().Field(i)
			if !field.IsExported() {
				continue
			}
			if v.Type() == reflect.TypeOf(d2scene.FontAsset{}) && field.Name == "Data" {
				continue
			}
			child, err := encode(v.Field(i), fonts, path+"."+field.Name)
			if err != nil {
				return nil, err
			}
			out[field.Name] = child
		}
		return out, nil
	case reflect.Slice:
		if v.Type().Elem().Kind() == reflect.Uint8 {
			return v.Bytes(), nil
		}
		out := make([]any, v.Len())
		for i := range out {
			child, err := encode(v.Index(i), fonts, fmt.Sprintf("%s[%d]", path, i))
			if err != nil {
				return nil, err
			}
			out[i] = child
		}
		return out, nil
	case reflect.Map:
		out := map[string]any{}
		for _, key := range v.MapKeys() {
			if font, ok := v.MapIndex(key).Interface().(d2scene.FontAsset); ok {
				fonts[d2scene.AssetID(fmt.Sprint(key.Interface()))] = font.Data
			}
			child, err := encode(v.MapIndex(key), fonts, path+"."+fmt.Sprint(key.Interface()))
			if err != nil {
				return nil, err
			}
			out[fmt.Sprint(key.Interface())] = child
		}
		return out, nil
	case reflect.Bool, reflect.String, reflect.Float32, reflect.Float64,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return v.Interface(), nil
	default:
		return nil, fmt.Errorf("scenejson: unsupported kind %s at %s", v.Kind(), path)
	}
}

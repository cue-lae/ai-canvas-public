using System.IO;
using System.Text.Json;
using System.Windows.Media;
using System.Windows.Media.Imaging;

internal static class Program
{
    private sealed record Raster(int Width,int Height,byte[] Pixels);
    private static Raster Read(string path)
    {
        using var input=File.OpenRead(path);
        var frame=BitmapDecoder.Create(input,BitmapCreateOptions.PreservePixelFormat,BitmapCacheOption.OnLoad).Frames[0];
        if(frame.Metadata is BitmapMetadata metadata) {
            foreach(var query in new[]{"/app1/ifd/{ushort=274}","/ifd/{ushort=274}"})
                if(metadata.ContainsQuery(query) && Convert.ToInt32(metadata.GetQuery(query)) is not 1)
                    throw new IOException("Image has EXIF orientation; provide an explicitly orientation-normalized original and matching geometry");
        }
        if(frame.PixelWidth<=0 || frame.PixelHeight<=0 || (long)frame.PixelWidth*frame.PixelHeight>100_000_000) throw new IOException("Unsupported image dimensions");
        var bitmap=new FormatConvertedBitmap(frame,PixelFormats.Bgra32,null,0);
        var bytes=new byte[checked(bitmap.PixelWidth*bitmap.PixelHeight*4)]; bitmap.CopyPixels(bytes,bitmap.PixelWidth*4,0);
        return new Raster(bitmap.PixelWidth,bitmap.PixelHeight,bytes);
    }
    private static void Write(string path,Raster image)
    {
        if(!string.Equals(Path.GetExtension(path),".png",StringComparison.OrdinalIgnoreCase)) throw new IOException("Output must be a new PNG file");
        var bitmap=BitmapSource.Create(image.Width,image.Height,96,96,PixelFormats.Bgra32,null,image.Pixels,image.Width*4);
        var encoder=new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var output=new FileStream(path,FileMode.CreateNew,FileAccess.Write); encoder.Save(output);
    }
    private static bool[] Mask(Raster source,Raster mask)
    {
        if(source.Width!=mask.Width || source.Height!=mask.Height) throw new IOException("Mask dimensions must equal the source");
        var selected=new bool[source.Width*source.Height];
        for(var p=0;p<selected.Length;p++) {
            var i=p*4; var v=mask.Pixels[i];
            if((v!=0 && v!=255) || mask.Pixels[i+1]!=v || mask.Pixels[i+2]!=v) throw new IOException("Mask must be binary black/white");
            selected[p]=v==255;
        }
        if(!selected.Any(x=>x)) throw new IOException("Mask contains no selected pixels");
        return selected;
    }
    private static byte[] Resize(Raster image,int width,int height)
    {
        if(image.Width==width && image.Height==height) return image.Pixels;
        var output=new byte[width*height*4];
        for(var y=0;y<height;y++) for(var x=0;x<width;x++) {
            var sx=(x+.5)*image.Width/width-.5; var sy=(y+.5)*image.Height/height-.5;
            Sample(image,sx,sy,output,(y*width+x)*4);
        }
        return output;
    }
    private static void Sample(Raster image,double x,double y,byte[] output,int destination)
    {
        x=Math.Clamp(x,0,image.Width-1); y=Math.Clamp(y,0,image.Height-1);
        var x0=(int)Math.Floor(x);var y0=(int)Math.Floor(y);var x1=Math.Min(x0+1,image.Width-1);var y1=Math.Min(y0+1,image.Height-1);
        var dx=x-x0;var dy=y-y0;
        for(var c=0;c<4;c++) output[destination+c]=(byte)Math.Clamp(Math.Round(
            image.Pixels[(y0*image.Width+x0)*4+c]*(1-dx)*(1-dy)+image.Pixels[(y0*image.Width+x1)*4+c]*dx*(1-dy)+
            image.Pixels[(y1*image.Width+x0)*4+c]*(1-dx)*dy+image.Pixels[(y1*image.Width+x1)*4+c]*dx*dy),0,255);
    }
    private static double Luma(byte[] p,int i)=>.0722*p[i]+.7152*p[i+1]+.2126*p[i+2];
    private static void Tint(byte[] output,byte[] source,int i,byte b,byte g,byte r)
    {
        var luminance=.0722*b+.7152*g+.2126*r;
        var scale=luminance<1?0:Luma(source,i)/luminance;
        output[i]=(byte)Math.Clamp(Math.Round(b*scale),0,255); output[i+1]=(byte)Math.Clamp(Math.Round(g*scale),0,255); output[i+2]=(byte)Math.Clamp(Math.Round(r*scale),0,255);
        output[i+3]=source[i+3];
    }
    private static double[] Mapping(string path,int width,int height)
    {
        using var json=JsonDocument.Parse(File.ReadAllText(path));
        var corners=json.RootElement.GetProperty("normalizedCorners");
        if(corners.GetArrayLength()!=4) throw new IOException("Reference mapping requires four explicit source-image corners");
        var uv=new[]{(0d,0d),(1d,0d),(1d,1d),(0d,1d)}; var a=new double[8,9];
        for(var i=0;i<4;i++) {
            var x=corners[i].GetProperty("x").GetDouble()*width;var y=corners[i].GetProperty("y").GetDouble()*height;
            if(!double.IsFinite(x)||!double.IsFinite(y)) throw new IOException("Invalid mapping point");
            var (u,v)=uv[i]; int row=i*2;
            a[row,0]=x;a[row,1]=y;a[row,2]=1;a[row,6]=-u*x;a[row,7]=-u*y;a[row,8]=u;
            a[row+1,3]=x;a[row+1,4]=y;a[row+1,5]=1;a[row+1,6]=-v*x;a[row+1,7]=-v*y;a[row+1,8]=v;
        }
        for(var col=0;col<8;col++) {
            var pivot=col;for(var row=col+1;row<8;row++) if(Math.Abs(a[row,col])>Math.Abs(a[pivot,col]))pivot=row;
            if(Math.Abs(a[pivot,col])<1e-10)throw new IOException("Degenerate reference mapping");
            for(var j=col;j<9;j++) (a[col,j],a[pivot,j])=(a[pivot,j],a[col,j]);
            var scale=a[col,col];for(var j=col;j<9;j++)a[col,j]/=scale;
            for(var row=0;row<8;row++)if(row!=col){var f=a[row,col];for(var j=col;j<9;j++)a[row,j]-=f*a[col,j];}
        }
        return Enumerable.Range(0,8).Select(i=>a[i,8]).ToArray();
    }
    [STAThread]
    public static int Main(string[] args)
    {
        try {
            if(args.Length==2 && args[0]=="info") { var info=Read(args[1]);Console.WriteLine(JsonSerializer.Serialize(new {width=info.Width,height=info.Height,pixelFormat="BGRA32"}));return 0; }
            var mode=args.FirstOrDefault();
            if((mode=="composite" && args.Length!=5)||(mode=="tint" && args.Length!=5)||(mode=="material" && args.Length!=6)||mode is not ("composite" or "tint" or "material"))throw new IOException("Use info, composite, tint or material with explicit input and output paths");
            var source=Read(args[1]);var mask=Read(args[mode=="composite"||mode=="material"?3:2]);var selected=Mask(source,mask);
            var output=(byte[])source.Pixels.Clone(); var outPath=args[^1];
            foreach(var input in args.Skip(1).Take(args.Length-2)) if(string.Equals(Path.GetFullPath(input),Path.GetFullPath(outPath),StringComparison.OrdinalIgnoreCase))throw new IOException("Output must not overwrite an input");
            if(mode=="composite") {
                var candidate=Resize(Read(args[2]),source.Width,source.Height);
                for(var p=0;p<selected.Length;p++)if(selected[p])Array.Copy(candidate,p*4,output,p*4,4);
            } else if(mode=="tint") {
                var color=args[3].TrimStart('#');if(color.Length!=6)throw new IOException("Tint requires RRGGBB");var rgb=Convert.FromHexString(color);
                for(var p=0;p<selected.Length;p++)if(selected[p])Tint(output,source.Pixels,p*4,rgb[2],rgb[1],rgb[0]);
            } else {
                var reference=Read(args[2]);var h=Mapping(args[4],source.Width,source.Height);var pixel=new byte[4];
                for(var p=0;p<selected.Length;p++)if(selected[p]) {
                    var x=p%source.Width;var y=p/source.Width;var denominator=h[6]*x+h[7]*y+1;
                    if(Math.Abs(denominator)<1e-10)throw new IOException("Mapping crosses infinity");
                    var u=(h[0]*x+h[1]*y+h[2])/denominator;var v=(h[3]*x+h[4]*y+h[5])/denominator;
                    if(u < -1e-7||u>1+1e-7||v < -1e-7||v>1+1e-7)throw new IOException("Reference mapping does not cover every selected pixel");
                    Sample(reference,u*(reference.Width-1),v*(reference.Height-1),pixel,0);
                    Tint(output,source.Pixels,p*4,pixel[0],pixel[1],pixel[2]);
                }
            }
            Write(outPath,new Raster(source.Width,source.Height,output));var written=Read(outPath);var changed=0;var outside=0;
            for(var p=0;p<selected.Length;p++){bool differs=false;for(var c=0;c<4;c++)differs|=source.Pixels[p*4+c]!=written.Pixels[p*4+c];if(differs){if(selected[p])changed++;else outside++;}}
            if(outside!=0)throw new IOException("Outside-mask pixel verification failed; do not deliver output");
            Console.WriteLine(JsonSerializer.Serialize(new {output=Path.GetFullPath(outPath),width=source.Width,height=source.Height,selectedPixels=selected.Count(x=>x),changedPixels=changed,outsideChanged=outside,mode}));return 0;
        } catch(Exception error) { Console.Error.WriteLine(error.Message);return 1; }
    }
}

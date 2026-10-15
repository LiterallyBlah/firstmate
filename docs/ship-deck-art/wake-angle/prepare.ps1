$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
public static class WakePrep {
  public static Bitmap Sample(string path, string[] hex) {
    var palette = Array.ConvertAll(hex, ColorTranslator.FromHtml);
    using(var src = new Bitmap(path)) {
      var dst = new Bitmap(240,96,PixelFormat.Format32bppArgb);
      for(int y=0;y<96;y++) for(int x=0;x<240;x++) {
        int x0=(int)Math.Floor(8+x*8.2), x1=(int)Math.Floor(8+(x+1)*8.2);
        int y0=(int)Math.Floor(40+y*8.2), y1=(int)Math.Floor(40+(y+1)*8.2);
        var rr=new List<int>(); var gg=new List<int>(); var bb=new List<int>();
        for(int sy=y0;sy<y1;sy++) for(int sx=x0;sx<x1;sx++) {
          if(sx<0 || sy<0 || sx>=src.Width || sy>=src.Height) continue;
          Color c=src.GetPixel(sx,sy); if(c.A<192) continue;
          rr.Add(c.R); gg.Add(c.G); bb.Add(c.B);
        }
        if(rr.Count*2 < (x1-x0)*(y1-y0) || rr.Count==0) continue;
        rr.Sort(); gg.Sort(); bb.Sort(); int mid=rr.Count/2;
        int best=int.MaxValue; Color match=Color.Transparent;
        foreach(Color c in palette) {
          int d=(c.R-rr[mid])*(c.R-rr[mid])+(c.G-gg[mid])*(c.G-gg[mid])+(c.B-bb[mid])*(c.B-bb[mid]);
          if(d<best) { best=d; match=c; }
        }
        dst.SetPixel(x,y,match);
      }
      return dst;
    }
  }
  public static void Put(Bitmap dst,Bitmap src,int dx,int dy) {
    for(int y=0;y<src.Height;y++) for(int x=0;x<src.Width;x++) {
      int tx=dx+x,ty=dy+y; if(tx<0||ty<0||tx>=dst.Width||ty>=dst.Height)continue;
      Color c=src.GetPixel(x,y); if(c.A>0) dst.SetPixel(tx,ty,c);
    }
  }
  public static void Enlarge(Bitmap src,string path,int scale) {
    using(var dst=new Bitmap(src.Width*scale,src.Height*scale)) {
      for(int y=0;y<dst.Height;y++)for(int x=0;x<dst.Width;x++) dst.SetPixel(x,y,src.GetPixel(x/scale,y/scale));
      dst.Save(path,ImageFormat.Png);
    }
  }
}
'@
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
$manifest = Get-Content "$root/docs/ship-deck-art/water/manifest.json" -Raw | ConvertFrom-Json
$palette = [string[]]$manifest.assets.wake.frames[0].palette
$selected = @('04-contact.png','07-phase1-quiet.png','08-phase2-quiet.png')
$frames = @()
foreach ($name in $selected) { $frames += [WakePrep]::Sample("$PSScriptRoot/source/$name",$palette) }
# Freeze the generated contact region across phases, without rotating or drawing the wake.
for ($i=1; $i -lt 3; $i++) {
  for ($y=0; $y -lt 96; $y++) { for ($x=0; $x -lt 20; $x++) { $frames[$i].SetPixel($x,$y,$frames[0].GetPixel($x,$y)) } }
}
$strip = New-Object System.Drawing.Bitmap 720,96
$comparison = New-Object System.Drawing.Bitmap 480,288
for ($i=0; $i -lt 3; $i++) {
  $frames[$i].Save("$root/art/settings/ship/water/wake/frame-$i.png",[System.Drawing.Imaging.ImageFormat]::Png)
  [WakePrep]::Put($strip,$frames[$i],240*$i,0)
  $old = New-Object System.Drawing.Bitmap "$PSScriptRoot/before/frame-$i.png"
  [WakePrep]::Put($comparison,$old,0,96*$i)
  [WakePrep]::Put($comparison,$frames[$i],240,96*$i)
  $old.Dispose()
}
$strip.Save("$root/docs/ship-deck-art/water/wake/strip.png",[System.Drawing.Imaging.ImageFormat]::Png)
[WakePrep]::Enlarge($comparison,"$PSScriptRoot/review/before-after-3x.png",3)
# Independent static fit on the shipped sea/hull, with unchanged runtime placement.
$atlas = New-Object System.Drawing.Bitmap "$root/art/settings/ship/deck.png"
$hull = $atlas.Clone([System.Drawing.Rectangle]::new(0,0,426,161),[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for ($i=0; $i -lt 3; $i++) {
  $sea = New-Object System.Drawing.Bitmap "$root/art/settings/ship/water/sea/frame-$i.png"
  $foam = New-Object System.Drawing.Bitmap "$root/art/settings/ship/water/foam/frame-$i.png"
  $fit = New-Object System.Drawing.Bitmap 660,270
  for($y=0;$y -lt 270;$y++) { for($x=0;$x -lt 660;$x++) {
    $c = if($y -ge 96) {$sea.GetPixel($x % 256,($y-96)%128)} else {[System.Drawing.ColorTranslator]::FromHtml('#45617A')}
    $fit.SetPixel($x,$y,$c)
  }}
  [WakePrep]::Put($fit,$hull,0,0)
  for($y=151;$y -lt 270;$y++) { for($x=0;$x -lt 660;$x++) { $fit.SetPixel($x,$y,$sea.GetPixel($x%256,($y-96)%128)) } }
  [WakePrep]::Put($fit,$frames[$i],384,143)
  for($y=0;$y -lt 16;$y++) {for($x=68;$x -lt 392;$x++) {$c=$foam.GetPixel($x%256,$y); if($c.A -gt 0){$fit.SetPixel($x,142+$y,$c)}}}
  $fit.Save("$PSScriptRoot/review/hull-fit-$i.png",[System.Drawing.Imaging.ImageFormat]::Png)
  if($i -eq 0) {[WakePrep]::Enlarge($fit,"$PSScriptRoot/review/hull-fit-2x.png",2)}
  $fit.Dispose(); $sea.Dispose(); $foam.Dispose()
}
foreach($frame in $frames){$frame.Dispose()}
$atlas.Dispose(); $hull.Dispose(); $strip.Dispose(); $comparison.Dispose()

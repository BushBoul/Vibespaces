// Windows side of Vibespaces, compiled by helper.ps1 (Add-Type, so C# 5: no string interpolation, no ?.).
//   Taskbar: gives one VS Code window its own taskbar identity (AppUserModelID + relaunch command, icon, name),
//            so it gets its own button, shows the space's icon and can be pinned and reopened from the pin.
//   Icons:   makes a space's .ico (the VS Code logo in the space's colour, or a tile with initials).
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace Vibespaces {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey {
    public Guid fmtid; public uint pid;
    public PropertyKey(Guid g, uint p) { fmtid = g; pid = p; }
  }

  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr ptr;
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PropertyKey k);
    [PreserveSig] int GetValue(ref PropertyKey k, out PropVariant v);
    [PreserveSig] int SetValue(ref PropertyKey k, ref PropVariant v);
    [PreserveSig] int Commit();
  }

  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellLinkW {
    [PreserveSig] int GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder f, int cch, IntPtr fd, uint flags);
    [PreserveSig] int GetIDList(out IntPtr pidl);
    [PreserveSig] int SetIDList(IntPtr pidl);
    [PreserveSig] int GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int cch);
    [PreserveSig] int SetDescription([MarshalAs(UnmanagedType.LPWStr)] string s);
    [PreserveSig] int GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int cch);
    [PreserveSig] int SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string s);
    [PreserveSig] int GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int cch);
    [PreserveSig] int SetArguments([MarshalAs(UnmanagedType.LPWStr)] string s);
    [PreserveSig] int GetHotkey(out short k);
    [PreserveSig] int SetHotkey(short k);
    [PreserveSig] int GetShowCmd(out int c);
    [PreserveSig] int SetShowCmd(int c);
    [PreserveSig] int GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder s, int cch, out int idx);
    [PreserveSig] int SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string s, int idx);
    [PreserveSig] int SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string s, uint r);
    [PreserveSig] int Resolve(IntPtr hwnd, uint flags);
    [PreserveSig] int SetPath([MarshalAs(UnmanagedType.LPWStr)] string s);
  }
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CShellLink { }

  // A pinned space keeps the icon it was pinned with: Windows saves a shortcut for the pin and reuses it when the
  // same taskbar id is pinned again. So when a space's icon changes, the saved pins with its id get the new icon.
  public static class Pins {
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant v);
    [DllImport("shell32.dll")] static extern void SHChangeNotify(int e, uint flags, IntPtr a, IntPtr b);

    // icon: "path" or "path,index"; returns how many pins it changed
    public static int Update(string appId, string icon) {
      string path = icon; int index = 0;
      int comma = icon.LastIndexOf(',');
      if (comma > 0 && int.TryParse(icon.Substring(comma + 1), out index)) path = icon.Substring(0, comma);
      string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), @"Microsoft\Internet Explorer\Quick Launch\User Pinned");
      if (!Directory.Exists(root)) return 0;
      int n = 0;
      foreach (string f in Directory.GetFiles(root, "*.lnk", SearchOption.AllDirectories)) {
        object o = null;
        try {
          o = new CShellLink();
          ((System.Runtime.InteropServices.ComTypes.IPersistFile)o).Load(f, 2);     // STGM_READWRITE
          IPropertyStore ps = (IPropertyStore)o;
          PropertyKey k = new PropertyKey(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);   // PKEY_AppUserModel_ID
          PropVariant v;
          if (ps.GetValue(ref k, out v) != 0) continue;
          string id = v.vt == 31 ? Marshal.PtrToStringUni(v.ptr) : null;
          PropVariantClear(ref v);
          if (id != appId) continue;
          IShellLinkW l = (IShellLinkW)o;
          StringBuilder sb = new StringBuilder(1024); int had;
          l.GetIconLocation(sb, sb.Capacity, out had);
          if (string.Equals(sb.ToString(), path, StringComparison.OrdinalIgnoreCase) && had == index) continue;
          l.SetIconLocation(path, index);
          ((System.Runtime.InteropServices.ComTypes.IPersistFile)o).Save(f, true);
          n++;
        } catch {
          // a shortcut we can't read or write is left alone
        } finally {
          if (o != null) Marshal.ReleaseComObject(o);
        }
      }
      if (n > 0) SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);   // SHCNE_ASSOCCHANGED: icons changed
      return n;
    }
  }

  public static class Taskbar {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore s);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant v);

    // PKEY_AppUserModel_*
    static readonly Guid F = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    const uint RELAUNCH_COMMAND = 2, RELAUNCH_ICON = 3, RELAUNCH_NAME = 4, ID = 5;

    // Waits up to ~10 s for the window (its title can lag the extension starting), then sets its identity.
    // The taskbar only reads a window's ID when the button is added, so the window is hidden and shown once.
    public static string Identify(int processId, string title, string appId, string icon, string command, string name, bool force) {
      IntPtr h = IntPtr.Zero;
      for (int i = 0; i < 20 && h == IntPtr.Zero; i++) {
        h = Find(processId, title);
        if (h == IntPtr.Zero) Thread.Sleep(500);
      }
      if (h == IntPtr.Zero) return "no window titled '" + title + "' in process " + processId;
      int pins = Pins.Update(appId, icon);
      string pinNote = pins > 0 ? " (updated " + pins + " pin" + (pins == 1 ? "" : "s") + ")" : "";
      IPropertyStore s = Store(h);
      try {
        string had = Get(s, ID);
        // already this space's: done, unless its icon is an old one (a new icon design, say)
        if (had == appId && !force && Get(s, RELAUNCH_ICON) == icon) return "already " + appId + pinNote;
        Set(s, RELAUNCH_COMMAND, command);
        Set(s, RELAUNCH_ICON, icon);
        Set(s, RELAUNCH_NAME, name);
        Set(s, ID, appId);
        Check(s.Commit(), "Commit");
      } finally {
        Marshal.ReleaseComObject(s);
      }
      Rebutton(h);
      return "set " + appId + " on window " + h + pinNote;
    }

    // The visible window of processId whose title is the space's name, or starts with it (window.title puts it first).
    // A title that only contains the name counts when exactly one window has it.
    internal static IntPtr Find(int processId, string title) {
      IntPtr exact = IntPtr.Zero, loose = IntPtr.Zero;
      int looseCount = 0;
      EnumWindows(delegate (IntPtr h, IntPtr l) {
        if (!IsWindowVisible(h)) return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (pid != (uint)processId) return true;
        StringBuilder sb = new StringBuilder(512); GetWindowText(h, sb, 512);
        string t = sb.ToString();
        if (t.Length == 0) return true;
        if (t == title || t.StartsWith(title + " - ") || t.StartsWith(title + " — ")) {
          if (exact == IntPtr.Zero) exact = h;
        } else if (t.IndexOf(title, StringComparison.OrdinalIgnoreCase) >= 0) {
          loose = h; looseCount++;
        }
        return true;
      }, IntPtr.Zero);
      return exact != IntPtr.Zero ? exact : (looseCount == 1 ? loose : IntPtr.Zero);
    }

    static void Rebutton(IntPtr h) {
      bool front = GetForegroundWindow() == h;
      ShowWindow(h, 0);                    // SW_HIDE
      Thread.Sleep(150);
      ShowWindow(h, front ? 5 : 8);        // SW_SHOW : SW_SHOWNA (no focus change)
      if (front) SetForegroundWindow(h);
    }

    static IPropertyStore Store(IntPtr h) {
      Guid iid = typeof(IPropertyStore).GUID;
      IPropertyStore s;
      Check(SHGetPropertyStoreForWindow(h, ref iid, out s), "SHGetPropertyStoreForWindow");
      return s;
    }

    static string Get(IPropertyStore s, uint pid) {
      PropertyKey k = new PropertyKey(F, pid);
      PropVariant v;
      if (s.GetValue(ref k, out v) != 0) return null;
      string r = v.vt == 31 ? Marshal.PtrToStringUni(v.ptr) : null;   // VT_LPWSTR
      PropVariantClear(ref v);
      return r;
    }

    static void Set(IPropertyStore s, uint pid, string value) {
      PropertyKey k = new PropertyKey(F, pid);
      PropVariant v = new PropVariant();
      if (value != null) { v.vt = 31; v.ptr = Marshal.StringToCoTaskMemUni(value); }
      try { Check(s.SetValue(ref k, ref v), "SetValue " + pid); }
      finally { PropVariantClear(ref v); }
    }

    static void Check(int hr, string what) {
      if (hr != 0) throw new Exception(what + " failed: 0x" + hr.ToString("X8"));
    }
  }

  // Where a space's window sits on screen: read it, and put it back. Coordinates are real pixels (per-monitor DPI
  // aware), the same ones GetWindowRect and SetWindowPos use, so a saved position round-trips on scaled screens.
  public static class Placement {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromRect(ref RECT r, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    // A spot on the screen the window is on, as a share of its work area (the screen minus the taskbar).
    // The visible frame is what lines up with the screen edges: Windows' invisible resize borders sit outside it.
    // raise: also bring the window up above the others (without taking the focus), for a group coming home
    public static string Snap(int processId, string title, string where, bool raise, bool activate) {
      string r = Snap(processId, title, where, raise);
      if (activate) { IntPtr h = Window(processId, title); if (h != IntPtr.Zero) SetForegroundWindow(h); }
      return r;
    }

    public static string Place(int processId, string title, int x, int y, int width, int height, bool maximize, bool raise, bool activate) {
      string r = Place(processId, title, x, y, width, height, maximize, raise);
      if (activate) { IntPtr h = Window(processId, title); if (h != IntPtr.Zero) SetForegroundWindow(h); }
      return r;
    }

    public static string Snap(int processId, string title, string where, bool raise) {
      IntPtr h = Window(processId, title);
      if (h == IntPtr.Zero) return "no window titled '" + title + "'";
      if (where == "maximized") { ShowWindow(h, 3); if (raise) Raise(h); return "maximized"; }
      double share, from = 0; string side;
      switch (where) {
        case "second-quarter": side = "from"; from = 0.25; share = 0.25; break;
        case "third-quarter": side = "from"; from = 0.5; share = 0.25; break;
        case "middle-third": side = "from"; from = 1.0 / 3; share = 1.0 / 3; break;
        case "left-quarter": side = "left"; share = 0.25; break;
        case "left-third": side = "left"; share = 1.0 / 3; break;
        case "left-half": side = "left"; share = 0.5; break;
        case "right-half": side = "right"; share = 0.5; break;
        case "right-third": side = "right"; share = 1.0 / 3; break;
        case "right-quarter": side = "right"; share = 0.25; break;
        case "center": side = "center"; share = 0.6; break;
        default: return "unknown position '" + where + "'";
      }
      if (IsZoomed(h) || IsIconic(h)) ShowWindow(h, 9);                          // SW_RESTORE
      MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);                           // MONITOR_DEFAULTTONEAREST
      RECT wa = mi.rcWork;
      int W = wa.Right - wa.Left, H = wa.Bottom - wa.Top;
      int w = (int)Math.Round(W * share);
      int x = side == "left" ? wa.Left : side == "right" ? wa.Right - w
        : side == "from" ? wa.Left + (int)Math.Round(W * from) : wa.Left + (W - w) / 2;
      int y = wa.Top, height = H;
      RECT win, frame;
      GetWindowRect(h, out win);
      if (DwmGetWindowAttribute(h, 9, out frame, Marshal.SizeOf(typeof(RECT))) == 0) {   // DWMWA_EXTENDED_FRAME_BOUNDS
        int l = frame.Left - win.Left, t = frame.Top - win.Top, r = win.Right - frame.Right, b = win.Bottom - frame.Bottom;
        x -= l; y -= t; w += l + r; height += t + b;
      }
      SetWindowPos(h, IntPtr.Zero, x, y, w, height, 0x0004 | 0x0010);            // SWP_NOZORDER | SWP_NOACTIVATE
      if (raise) Raise(h);
      return "snapped " + where + ": " + x + "," + y + " " + w + "x" + height;
    }

    // up above the other windows, restored if minimized; activate: also give it the focus
    // (allowed after the global hotkey, whose listener lets any process take the foreground)
    public static string RaiseWindow(int processId, string title, bool activate) {
      IntPtr h = Window(processId, title);
      if (h == IntPtr.Zero) return "no window titled '" + title + "'";
      Raise(h);
      if (activate) SetForegroundWindow(h);
      return activate ? "raised and focused" : "raised";
    }

    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);

    // Windows won't let a program in the background simply put a window on top (HWND_TOP is quietly ignored when
    // another app is in front), but it will make a window "always on top" and back again, which leaves it on top.
    static void Raise(IntPtr h) {
      if (IsIconic(h)) ShowWindow(h, 4);                                         // SW_SHOWNOACTIVATE
      const uint keep = 0x0001 | 0x0002 | 0x0010;                                // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
      SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, keep);                         // HWND_TOPMOST
      SetWindowPos(h, new IntPtr(-2), 0, 0, 0, 0, keep);                         // HWND_NOTOPMOST
    }

    static IntPtr Window(int processId, string title) {
      SetThreadDpiAwarenessContext(new IntPtr(-4));   // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
      for (int i = 0; i < 8; i++) {
        IntPtr h = Taskbar.Find(processId, title);
        if (h != IntPtr.Zero) return h;
        Thread.Sleep(250);
      }
      return IntPtr.Zero;
    }

    // one line of JSON for the extension
    public static string Where(int processId, string title) {
      IntPtr h = Window(processId, title);
      if (h == IntPtr.Zero) return "{\"error\":\"no window titled '" + title.Replace("\"", "") + "'\"}";
      RECT r; GetWindowRect(h, out r);
      return "{\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"width\":" + (r.Right - r.Left) + ",\"height\":" + (r.Bottom - r.Top)
        + ",\"maximized\":" + (IsZoomed(h) ? "true" : "false") + "}";
    }

    public static string Place(int processId, string title, int x, int y, int width, int height, bool maximize, bool raise) {
      IntPtr h = Window(processId, title);
      if (h == IntPtr.Zero) return "no window titled '" + title + "'";
      if (maximize) { ShowWindow(h, 3); if (raise) Raise(h); return "maximized"; }   // SW_MAXIMIZE
      RECT r; r.Left = x; r.Top = y; r.Right = x + width; r.Bottom = y + height;
      if (MonitorFromRect(ref r, 0) == IntPtr.Zero) { if (raise) Raise(h); return "skipped: that position is off every screen now"; }   // MONITOR_DEFAULTTONULL
      if (IsZoomed(h) || IsIconic(h)) ShowWindow(h, 9);                          // SW_RESTORE
      SetWindowPos(h, IntPtr.Zero, x, y, width, height, 0x0004 | 0x0010);        // SWP_NOZORDER | SWP_NOACTIVATE
      if (raise) Raise(h);
      return "placed at " + x + "," + y + " " + width + "x" + height;
    }
  }

  // The shortcut that works from anywhere: holds a system-wide hotkey and prints "hotkey" each time it's pressed.
  // Only one program can hold a hotkey, so of all the VS Code windows that start one of these, one wins ("listening")
  // and the rest stop ("taken"). It stops when the extension host that started it goes.
  public static class Hotkey {
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x, y; }
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);

    public static int Listen(uint mods, uint vk, int ownerPid) {
      System.Diagnostics.Process owner;
      try { owner = System.Diagnostics.Process.GetProcessById(ownerPid); } catch { return 3; }
      if (!RegisterHotKey(IntPtr.Zero, 1, mods | 0x4000, vk)) { Console.WriteLine("taken"); return 2; }   // MOD_NOREPEAT
      Console.WriteLine("listening");
      try {
        while (!owner.WaitForExit(0)) {
          MSG m;
          if (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) {                       // PM_REMOVE
            if (m.message == 0x0312) {                                           // WM_HOTKEY
              AllowSetForegroundWindow(-1);                                      // ASFW_ANY: the window that answers may take the focus
              Console.WriteLine("hotkey");
            }
          } else {
            Thread.Sleep(40);
          }
        }
      } finally {
        UnregisterHotKey(IntPtr.Zero, 1);
      }
      return 0;
    }
  }

  public static class Icons {
    static readonly int[] Sizes = { 16, 20, 24, 32, 40, 48, 64, 256 };
    const double VSCODE_HUE = 205.0;   // the logo's blue

    // style "window": a little app window in the colour (the default); "initials": text is the initials;
    // "image": source is the user's picture; "vscode" (opt-in): source is the user's own VS Code code.ico, recoloured
    public static string Make(string style, string color, string text, string source, string outPath) {
      Color c = ColorTranslator.FromHtml(color);
      Bitmap logo = style == "vscode" ? Tint(LoadLargest(source), c) : style == "image" ? LoadPicture(source) : null;
      List<byte[]> pngs = new List<byte[]>();
      foreach (int s in Sizes) {
        using (Bitmap b = logo != null ? Resize(logo, s) : style == "window" ? WindowGlyph(c, s) : Tile(c, text, s)) pngs.Add(Png(b));
      }
      if (logo != null) logo.Dispose();
      WriteIco(outPath, pngs);
      return "icon " + outPath;
    }

    // largest frame of an .ico (PNG frames read directly; older bitmap frames through Icon)
    static Bitmap LoadLargest(string path) {
      byte[] all = File.ReadAllBytes(path);
      int count = BitConverter.ToUInt16(all, 4), best = -1, bestSize = 0;
      for (int i = 0; i < count; i++) {
        int w = all[6 + 16 * i]; if (w == 0) w = 256;
        if (w > bestSize) { bestSize = w; best = i; }
      }
      int len = BitConverter.ToInt32(all, 6 + 16 * best + 8), off = BitConverter.ToInt32(all, 6 + 16 * best + 12);
      Bitmap b = new Bitmap(bestSize, bestSize, PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(b)) {
        if (all[off] == 0x89 && all[off + 1] == 0x50) {
          using (MemoryStream ms = new MemoryStream(all, off, len))
          using (Image img = Image.FromStream(ms)) g.DrawImage(img, 0, 0, bestSize, bestSize);
        } else {
          using (Icon ic = new Icon(path, bestSize, bestSize))
          using (Bitmap img = ic.ToBitmap()) g.DrawImage(img, 0, 0, bestSize, bestSize);
        }
      }
      return b;
    }

    // a picture (png, jpg, ico...) fitted into a 256 px square, centred, keeping its shape
    static Bitmap LoadPicture(string path) {
      if (path.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)) return LoadLargest(path);
      Bitmap b = new Bitmap(256, 256, PixelFormat.Format32bppArgb);
      using (Image img = Image.FromFile(path))
      using (Graphics g = Graphics.FromImage(b)) {
        Quality(g);
        double k = 256.0 / Math.Max(img.Width, img.Height);
        int w = (int)Math.Round(img.Width * k), h = (int)Math.Round(img.Height * k);
        g.DrawImage(img, (256 - w) / 2, (256 - h) / 2, w, h);
      }
      return b;
    }

    // turns the logo's blue to the target hue, keeping its shading; greys get a nearly grey logo
    static Bitmap Tint(Bitmap src, Color target) {
      Bitmap b = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(b)) g.DrawImage(src, 0, 0, src.Width, src.Height);
      double th, ts, tv; ToHsv(target.R, target.G, target.B, out th, out ts, out tv);
      bool grey = ts < 0.12;
      Rectangle r = new Rectangle(0, 0, b.Width, b.Height);
      BitmapData d = b.LockBits(r, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      int n = d.Stride * d.Height;
      byte[] px = new byte[n];
      Marshal.Copy(d.Scan0, px, 0, n);
      for (int i = 0; i < n; i += 4) {
        if (px[i + 3] == 0) continue;
        double h, s, v; ToHsv(px[i + 2], px[i + 1], px[i], out h, out s, out v);
        h = (h + th - VSCODE_HUE + 720.0) % 360.0;
        if (grey) s *= 0.15;
        byte R, G, B; FromHsv(h, s, v, out R, out G, out B);
        px[i + 2] = R; px[i + 1] = G; px[i] = B;
      }
      Marshal.Copy(px, 0, d.Scan0, n);
      b.UnlockBits(d);
      return b;
    }

    // a little app window in the space's colour: a darker title bar, and dots and lines once there's room for them
    static Bitmap WindowGlyph(Color c, int s) {
      Bitmap b = new Bitmap(s, s, PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(b)) {
        Quality(g);
        float pad = s * 0.06f, w = s - 2 * pad, h = w * 0.86f, top = (s - h) / 2;
        RectangleF r = new RectangleF(pad, top, w, h);
        float rad = s * 0.14f, bar = h * 0.26f;
        Color dark = Color.FromArgb(c.R * 3 / 4, c.G * 3 / 4, c.B * 3 / 4);
        bool light = Luma(c) > 0.62;
        Color ink = light ? Color.FromArgb(200, 30, 30, 30) : Color.FromArgb(220, 255, 255, 255);
        using (GraphicsPath p = Rounded(r, rad)) {
          using (SolidBrush br = new SolidBrush(c)) g.FillPath(br, p);
          g.SetClip(p);
          using (SolidBrush br = new SolidBrush(dark)) g.FillRectangle(br, r.X, r.Y, r.Width, bar);
          g.ResetClip();
        }
        using (SolidBrush inkBr = new SolidBrush(ink)) {
          if (s >= 40) {
            // Windows' title bar buttons, on the right: minimize, maximize, close
            float k = bar * 0.34f, cy = r.Y + bar / 2, gap = k * 1.25f, x = r.Right - w * 0.10f - k;
            using (Pen pen = new Pen(ink, Math.Max(1f, s / 128f * 2.2f))) {
              g.DrawLine(pen, x - 2 * (k + gap), cy, x - 2 * (k + gap) + k, cy);
              g.DrawRectangle(pen, x - (k + gap), cy - k / 2, k, k);
              g.DrawLine(pen, x, cy - k / 2, x + k, cy + k / 2);
              g.DrawLine(pen, x, cy + k / 2, x + k, cy - k / 2);
            }
          }
          if (s >= 32) {
            float lw = h * 0.075f, x0 = r.X + w * 0.13f;
            float[] len = { 0.62f, 0.78f, 0.46f };
            int lines = s >= 48 ? 3 : 2;
            for (int i = 0; i < lines; i++) {
              float y = r.Y + bar + h * 0.16f + i * h * 0.16f;
              using (GraphicsPath lp = Rounded(new RectangleF(x0, y, w * 0.74f * len[i], lw), lw / 2)) g.FillPath(inkBr, lp);
            }
          }
        }
      }
      return b;
    }

    // The initials tile: fills the icon, in a brightened version of the space's colour (a taskbar icon in a deep
    // title-bar colour looks dull), with a soft top-to-bottom shade and the initials big and heavy, centred by their
    // actual outline rather than the font's line box.
    static Bitmap Tile(Color c0, string text, int s) {
      Color c = Bright(c0);
      Bitmap b = new Bitmap(s, s, PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(b)) {
        Quality(g);
        float pad = s >= 32 ? s * 0.02f : 0;
        RectangleF r = new RectangleF(pad, pad, s - 2 * pad, s - 2 * pad);
        using (GraphicsPath p = Rounded(r, s * 0.20f))
        using (LinearGradientBrush br = new LinearGradientBrush(r, Shade(c, 1.10), Shade(c, 0.86), 90f)) g.FillPath(br, p);
        string t = s < 24 && text.Length > 1 ? text.Substring(0, 1) : text;
        bool dark = Luma(c) > 0.72;
        using (FontFamily fam = Family("Segoe UI Black", "Segoe UI"))
        using (GraphicsPath tp = new GraphicsPath())
        using (StringFormat sf = StringFormat.GenericTypographic) {
          FontStyle st = fam.Name == "Segoe UI Black" ? FontStyle.Regular : FontStyle.Bold;
          tp.AddString(t, fam, (int)st, s * (t.Length > 1 ? 0.56f : 0.70f), PointF.Empty, sf);
          RectangleF tb = tp.GetBounds();
          float k = Math.Min(1f, r.Width * 0.80f / tb.Width);   // two wide letters (WM) stay inside the tile
          using (Matrix m = new Matrix()) {
            m.Translate(r.X + r.Width / 2, r.Y + r.Height / 2);
            m.Scale(k, k);
            m.Translate(-(tb.X + tb.Width / 2), -(tb.Y + tb.Height / 2));
            tp.Transform(m);
          }
          if (s >= 32 && !dark) {
            using (GraphicsPath sh = (GraphicsPath)tp.Clone())
            using (Matrix d = new Matrix())
            using (SolidBrush sb = new SolidBrush(Color.FromArgb(70, 0, 0, 0))) {
              d.Translate(0, s * 0.02f); sh.Transform(d); g.FillPath(sb, sh);
            }
          }
          using (SolidBrush fg = new SolidBrush(dark ? Color.FromArgb(32, 32, 36) : Color.White)) g.FillPath(fg, tp);
        }
      }
      return b;
    }

    // the space's colour lifted to icon brightness (like the recoloured logo, which kept VS Code's bright blue);
    // greys stay grey
    static Color Bright(Color c) {
      double h, s, v; ToHsv(c.R, c.G, c.B, out h, out s, out v);
      if (s >= 0.35) s = Math.Max(s, 0.62);   // clearly colourful: richer; slates and greys keep their own
      v = Math.Max(v, 0.84);
      byte R, G, B; FromHsv(h, s, v, out R, out G, out B);
      return Color.FromArgb(R, G, B);
    }

    static Color Shade(Color c, double k) {
      Func<int, int> f = x => (int)Math.Max(0, Math.Min(255, Math.Round(x * k)));
      return Color.FromArgb(f(c.R), f(c.G), f(c.B));
    }

    static FontFamily Family(string want, string fallback) {
      try { return new FontFamily(want); } catch (ArgumentException) { return new FontFamily(fallback); }
    }

    static GraphicsPath Rounded(RectangleF r, float rad) {
      float d = rad * 2;
      GraphicsPath p = new GraphicsPath();
      p.AddArc(r.X, r.Y, d, d, 180, 90);
      p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
      p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
      p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
      p.CloseFigure();
      return p;
    }

    static Bitmap Resize(Bitmap src, int s) {
      Bitmap b = new Bitmap(s, s, PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(b)) { Quality(g); g.DrawImage(src, 0, 0, s, s); }
      return b;
    }

    static void Quality(Graphics g) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
    }

    static byte[] Png(Bitmap b) {
      using (MemoryStream ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); return ms.ToArray(); }
    }

    // an .ico of PNG frames (Windows Vista and later read these at every size)
    static void WriteIco(string path, List<byte[]> pngs) {
      Directory.CreateDirectory(Path.GetDirectoryName(path));
      string tmp = path + ".tmp";
      using (FileStream fs = new FileStream(tmp, FileMode.Create))
      using (BinaryWriter w = new BinaryWriter(fs)) {
        w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)Sizes.Length);
        int offset = 6 + 16 * Sizes.Length;
        for (int i = 0; i < Sizes.Length; i++) {
          byte dim = (byte)(Sizes[i] >= 256 ? 0 : Sizes[i]);
          w.Write(dim); w.Write(dim); w.Write((byte)0); w.Write((byte)0);
          w.Write((ushort)1); w.Write((ushort)32);
          w.Write((uint)pngs[i].Length); w.Write((uint)offset);
          offset += pngs[i].Length;
        }
        foreach (byte[] p in pngs) w.Write(p);
      }
      if (File.Exists(path)) File.Delete(path);
      File.Move(tmp, path);
    }

    static double Luma(Color c) { return (0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B) / 255.0; }

    static void ToHsv(byte r, byte g, byte b, out double h, out double s, out double v) {
      double R = r / 255.0, G = g / 255.0, B = b / 255.0;
      double max = Math.Max(R, Math.Max(G, B)), min = Math.Min(R, Math.Min(G, B)), d = max - min;
      v = max; s = max == 0 ? 0 : d / max;
      if (d == 0) h = 0;
      else if (max == R) h = 60 * (((G - B) / d) % 6);
      else if (max == G) h = 60 * ((B - R) / d + 2);
      else h = 60 * ((R - G) / d + 4);
      if (h < 0) h += 360;
    }

    static void FromHsv(double h, double s, double v, out byte r, out byte g, out byte b) {
      double c = v * s, x = c * (1 - Math.Abs((h / 60) % 2 - 1)), m = v - c, R = 0, G = 0, B = 0;
      if (h < 60) { R = c; G = x; } else if (h < 120) { R = x; G = c; } else if (h < 180) { G = c; B = x; }
      else if (h < 240) { G = x; B = c; } else if (h < 300) { R = x; B = c; } else { R = c; B = x; }
      r = (byte)Math.Round((R + m) * 255); g = (byte)Math.Round((G + m) * 255); b = (byte)Math.Round((B + m) * 255);
    }
  }
}

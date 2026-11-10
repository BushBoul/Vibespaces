// vibespaces-helper.exe: the Windows side of Vibespaces as a small program (the work is in Native.cs).
// Arguments are -Name value pairs plus a few switches; it prints one line of result, or an error and exit code 1.
//   identify: give one VS Code window its own taskbar button
//   where:    the window's position and size, as JSON
//   place:    put the window at a position and size (or maximize it)
//   snap:     put the window in a preset spot (left-quarter, right-third, center, maximized...) on its screen
//   raise:    bring the window up above the others (-Raise does it with place and snap too; -Activate also focuses it)
//   hotkey:   hold a system-wide shortcut and print "hotkey" each time it's pressed, until -OwnerPid exits
//   pins:     point the saved taskbar pins of -AppId at -Icon (identify does this too)
//   icon:     make a space's .ico
// Built by tools/build-helper.js with the C# compiler that ships with Windows (.NET Framework 4, C# 5).
using System;
using System.Collections.Generic;

namespace Vibespaces {
  static class Program {
    static readonly HashSet<string> Switches = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Force", "Maximize", "Raise", "Activate" };

    static int Main(string[] argv) {
      Dictionary<string, string> a = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      for (int i = 0; i < argv.Length; i++) {
        if (!argv[i].StartsWith("-")) continue;
        string k = argv[i].Substring(1);
        if (Switches.Contains(k)) a[k] = "1";
        else if (i + 1 < argv.Length) a[k] = argv[++i];
      }
      Func<string, string> s = k => a.ContainsKey(k) ? a[k] : "";
      Func<string, int> n = k => { int v; return int.TryParse(s(k), out v) ? v : 0; };
      Func<string, bool> on = k => a.ContainsKey(k);
      try {
        string r;
        switch (s("Action")) {
          case "identify": r = Taskbar.Identify(n("ProcessId"), s("Title"), s("AppId"), s("Icon"), s("Command"), s("DisplayName"), on("Force")); break;
          case "where": r = Placement.Where(n("ProcessId"), s("Title")); break;
          case "place": r = Placement.Place(n("ProcessId"), s("Title"), n("X"), n("Y"), n("Width"), n("Height"), on("Maximize"), on("Raise"), on("Activate")); break;
          case "snap": r = Placement.Snap(n("ProcessId"), s("Title"), s("Where"), on("Raise"), on("Activate")); break;
          case "raise": r = Placement.RaiseWindow(n("ProcessId"), s("Title"), on("Activate")); break;
          case "pins": r = "updated " + Pins.Update(s("AppId"), s("Icon")) + " pin(s)"; break;
          case "hotkey": return Hotkey.Listen((uint)n("Mods"), (uint)n("Key"), n("OwnerPid"));
          case "icon": r = Icons.Make(s("Style") == "" ? "window" : s("Style"), s("Color"), s("Text"), s("Source"), s("Out")); break;
          default: Console.Error.WriteLine("unknown action '" + s("Action") + "'"); return 1;
        }
        Console.WriteLine(r);
        return 0;
      } catch (Exception e) {
        Console.Error.WriteLine(e.Message);
        return 1;
      }
    }
  }
}

' Launches the orb with no console window at all.
' start.bat works too, but flashes a cmd window on the way through.

Dim dir, q, sh
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
q = Chr(34)

Set sh = CreateObject("WScript.Shell")
sh.Run q & dir & "node_modules\electron\dist\electron.exe" & q & " " & q & dir & "." & q, 0, False

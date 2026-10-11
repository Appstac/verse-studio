' Runs a PowerShell script with no window at all (scheduled tasks would otherwise flash a console).
' Usage: wscript.exe hidden.vbs "C:\path\script.ps1" [args...]
Set sh = CreateObject("WScript.Shell")
args = ""
For i = 1 To WScript.Arguments.Count - 1
  args = args & " """ & WScript.Arguments(i) & """"
Next
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """" & args, 0, False

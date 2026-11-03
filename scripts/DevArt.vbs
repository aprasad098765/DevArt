' Runs the DevArt launcher with no console window. The Desktop and Start Menu shortcuts point here.
Option Explicit
Dim shell, fso, root, code
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root

On Error Resume Next
code = shell.Run("node scripts\launcher.ts open", 0, True)
If Err.Number <> 0 Then
  MsgBox "DevArt couldn't start because Node.js wasn't found. Install Node.js 24 or newer, then try again.", vbExclamation, "DevArt"
  WScript.Quit 1
End If
On Error GoTo 0

If code <> 0 Then
  MsgBox "DevArt couldn't start. Details are in:" & vbCrLf & root & "\data\server.log", vbExclamation, "DevArt"
End If
WScript.Quit code

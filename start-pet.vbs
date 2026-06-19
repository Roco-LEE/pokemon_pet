' 포켓몬 펫을 콘솔 창 없이 조용히 실행하는 런처. 더블클릭해서 사용.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = scriptDir
electron = """" & scriptDir & "\node_modules\.bin\electron.cmd"" ."
' 0 = 창 숨김, False = 종료를 기다리지 않음(즉시 반환)
sh.Run electron, 0, False

@echo off
rem Weekly-learnings automation — run by Windows Task Scheduler (Sundays 20:04).
rem Compiles drafts/inbox.md into published learnings notes via the
rem weekly-note skill, headless. Logs to drafts\ (gitignored, stays local).
cd /d "%~dp0.."
if not exist drafts mkdir drafts
echo ==== %date% %time% ==== >> "drafts\weekly-note-task.log"
"%USERPROFILE%\.local\bin\claude.exe" -p "/weekly-note" ^
  --allowedTools "Read,Write,Edit,Glob,Grep,Skill,Bash(npm run build),Bash(git *),Bash(mv *),Bash(mkdir *),PowerShell(git *),PowerShell(npm run build)" ^
  < nul >> "drafts\weekly-note-task.log" 2>&1

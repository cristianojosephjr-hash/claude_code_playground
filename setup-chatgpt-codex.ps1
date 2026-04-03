[CmdletBinding()]
param(
    [Parameter()]
    [string]$BaseDir = (Join-Path -Path $HOME -ChildPath 'ChatGPT-Codex')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RepositoryDefinitions {
    return @(
        [pscustomobject][ordered]@{
            Name        = 'learn-claude-code'
            Owner       = 'cristianojosephjr-hash'
            Repo        = 'learn-claude-code'
            ZipFileName = 'learn-claude-code.zip'
            Description = 'Bash is all you need - A nano claude code-like agent harness, built from 0 to 1'
            Languages   = 'TypeScript (59.2%), Python (39%), CSS (1.8%)'
            Files       = 'Agents, Skills, Tests, Docs, Web components'
        }
        [pscustomobject][ordered]@{
            Name        = 'claude-code-instructkr'
            Owner       = 'cristianojosephjr-hash'
            Repo        = 'claude-code-instructkr'
            ZipFileName = 'claude-code-instructkr.zip'
            Description = 'An independent Python feature port of Claude Code, entirely rewriting from scratch using oh-my-codex'
            Languages   = 'Python (100%)'
            Files       = 'src/, tests/, assets/'
        }
        [pscustomobject][ordered]@{
            Name        = 'claude-code'
            Owner       = 'cristianojosephjr-hash'
            Repo        = 'claude-code'
            ZipFileName = 'claude-code.zip'
            Description = 'Fork of instructkr/claude-code'
            Languages   = 'TypeScript (100%)'
            Files       = 'src/'
        }
        [pscustomobject][ordered]@{
            Name        = 'claude_code_bridge'
            Owner       = 'cristianojosephjr-hash'
            Repo        = 'claude_code_bridge'
            ZipFileName = 'claude_code_bridge.zip'
            Description = 'Real-time multi-AI collaboration: Claude, Codex & Gemini with persistent context'
            Languages   = 'Python (89.2%), Shell (7.4%), PowerShell (1.9%), HTML (1.4%)'
            Files       = 'bin/, lib/, claude_skills/, codex_skills/, droid_skills/, mcp/'
        }
        [pscustomobject][ordered]@{
            Name        = 'claude-code-log'
            Owner       = 'cristianojosephjr-hash'
            Repo        = 'claude-code-log'
            ZipFileName = 'claude-code-log.zip'
            Description = 'A Python CLI tool that converts Claude Code transcript JSONL files into readable HTML'
            Languages   = 'Python (66.5%), HTML (30%), CSS (2.7%)'
            Files       = 'claude_code_log/, dev-docs/, test/, scripts/'
        }
    )
}

function Get-ZipUrl {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Repository
    )

    return "https://github.com/$($Repository.Owner)/$($Repository.Repo)/archive/refs/heads/main.zip"
}

function Download-RepositoryZip {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Repository,
        [Parameter(Mandatory = $true)]
        [string]$DestinationDirectory
    )

    $url = Get-ZipUrl -Repository $Repository
    $zipPath = Join-Path -Path $DestinationDirectory -ChildPath $Repository.ZipFileName

    try {
        Write-Host "Downloading $($Repository.Name) -> $($Repository.ZipFileName)"
        Invoke-WebRequest -Uri $url -OutFile $zipPath
    }
    catch {
        throw "Failed to download '$($Repository.Name)' from '$url' to '$zipPath'. $($_.Exception.Message)"
    }
}

function New-RepoIndexMarkdown {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject[]]$Repositories
    )

    $builder = New-Object System.Text.StringBuilder
    [void]$builder.AppendLine('# ChatGPT Codex - 5 Claude Code Repositories')
    [void]$builder.AppendLine()
    [void]$builder.AppendLine('## Repository Index')
    [void]$builder.AppendLine()

    for ($index = 0; $index -lt $Repositories.Count; $index++) {
        $repo = $Repositories[$index]
        $number = $index + 1
        $link = "https://github.com/$($repo.Owner)/$($repo.Repo)"
        [void]$builder.AppendLine("### $number. **$($repo.Name)**")
        [void]$builder.AppendLine("- **Description**: $($repo.Description)")
        [void]$builder.AppendLine("- **Languages**: $($repo.Languages)")
        [void]$builder.AppendLine("- **Link**: $link")
        [void]$builder.AppendLine("- **Files**: $($repo.Files)")
        [void]$builder.AppendLine()
    }

    [void]$builder.AppendLine('---')
    [void]$builder.AppendLine()
    [void]$builder.AppendLine('## Quick Access via GitHub API')
    [void]$builder.AppendLine()
    [void]$builder.AppendLine('All repositories are publicly accessible. Use these GitHub API endpoints:')
    [void]$builder.AppendLine()
    [void]$builder.AppendLine('### Base Pattern')
    [void]$builder.AppendLine('- `https://api.github.com/repos/{owner}/{repo}`')
    [void]$builder.AppendLine()

    [void]$builder.AppendLine('### Get Repository Information')
    foreach ($repo in $Repositories) {
        $apiBase = "https://api.github.com/repos/$($repo.Owner)/$($repo.Repo)"
        [void]$builder.AppendLine("- **$($repo.Name)**: $apiBase")
    }
    [void]$builder.AppendLine()

    [void]$builder.AppendLine('### List Branches')
    foreach ($repo in $Repositories) {
        $endpoint = "https://api.github.com/repos/$($repo.Owner)/$($repo.Repo)/branches"
        [void]$builder.AppendLine("- **$($repo.Name)**: $endpoint")
    }
    [void]$builder.AppendLine()

    [void]$builder.AppendLine('### List Repository Contents (Root)')
    foreach ($repo in $Repositories) {
        $endpoint = "https://api.github.com/repos/$($repo.Owner)/$($repo.Repo)/contents"
        [void]$builder.AppendLine("- **$($repo.Name)**: $endpoint")
    }
    [void]$builder.AppendLine()

    [void]$builder.AppendLine('### Get Recursive Tree (for full file listing)')
    foreach ($repo in $Repositories) {
        $endpoint = "https://api.github.com/repos/$($repo.Owner)/$($repo.Repo)/git/trees/main?recursive=1"
        [void]$builder.AppendLine("- **$($repo.Name)**: $endpoint")
    }
    [void]$builder.AppendLine()

    [void]$builder.AppendLine('### Download Zipball (default branch)')
    foreach ($repo in $Repositories) {
        $endpoint = "https://api.github.com/repos/$($repo.Owner)/$($repo.Repo)/zipball/main"
        [void]$builder.AppendLine("- **$($repo.Name)**: $endpoint")
    }
    [void]$builder.AppendLine()

    [void]$builder.AppendLine('### List Commits')
    foreach ($repo in $Repositories) {
        $endpoint = "https://api.github.com/repos/$($repo.Owner)/$($repo.Repo)/commits"
        [void]$builder.AppendLine("- **$($repo.Name)**: $endpoint")
    }
    [void]$builder.AppendLine()

    [void]$builder.AppendLine('### List Releases')
    foreach ($repo in $Repositories) {
        $endpoint = "https://api.github.com/repos/$($repo.Owner)/$($repo.Repo)/releases"
        [void]$builder.AppendLine("- **$($repo.Name)**: $endpoint")
    }
    [void]$builder.AppendLine()

    [void]$builder.AppendLine('### List Contributors')
    foreach ($repo in $Repositories) {
        $endpoint = "https://api.github.com/repos/$($repo.Owner)/$($repo.Repo)/contributors"
        [void]$builder.AppendLine("- **$($repo.Name)**: $endpoint")
    }
    [void]$builder.AppendLine()

    return $builder.ToString()
}

try {
    New-Item -Path $BaseDir -ItemType Directory -Force | Out-Null
    Set-Location -Path $BaseDir

    $repositories = Get-RepositoryDefinitions

    foreach ($repository in $repositories) {
        Download-RepositoryZip -Repository $repository -DestinationDirectory $BaseDir
    }

    $indexPath = Join-Path -Path $BaseDir -ChildPath 'REPOS_INDEX.md'
    $markdown = New-RepoIndexMarkdown -Repositories $repositories
    Set-Content -Path $indexPath -Value $markdown -Encoding utf8

    Write-Host "Completed successfully. Files generated in: $BaseDir"
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}

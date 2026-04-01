$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$dashboardDir = Join-Path $rootDir "dashboard"
$pageJsUrl = "https://www.streetfighter.com/6/_next/static/chunks/pages/character/%5Bname%5D/frame-a34e621b745a2747.js"
$characterSlugs = @(
  "aki",
  "alex",
  "blanka",
  "cammy",
  "chunli",
  "cviper",
  "deejay",
  "dhalsim",
  "ed",
  "ehonda",
  "elena",
  "gouki_akuma",
  "guile",
  "jamie",
  "jp",
  "juri",
  "ken",
  "kimberly",
  "lily",
  "luke",
  "mai",
  "manon",
  "marisa",
  "rashid",
  "ryu",
  "sagat",
  "terry",
  "vega_mbison",
  "zangief"
)

$characterLabels = @{
  "aki" = [regex]::Unescape('\u963f\u9b3c')
  "alex" = [regex]::Unescape('\u963f\u91cc\u514b\u65af')
  "blanka" = [regex]::Unescape('\u5e03\u5170\u5361')
  "cammy" = [regex]::Unescape('\u5609\u7c73')
  "chunli" = [regex]::Unescape('\u6625\u4e3d')
  "cviper" = [regex]::Unescape('\u6df1\u7ea2\u6bd2\u86c7')
  "deejay" = [regex]::Unescape('\u8fea\u6770')
  "dhalsim" = [regex]::Unescape('\u8fbe\u5c14\u897f\u59c6')
  "ed" = [regex]::Unescape('\u7231\u5fb7')
  "ehonda" = [regex]::Unescape('\u672c\u7530')
  "elena" = [regex]::Unescape('\u827e\u7433\u5a1c')
  "gouki_akuma" = [regex]::Unescape('\u8c6a\u9b3c')
  "guile" = [regex]::Unescape('\u53e4\u70c8')
  "jamie" = [regex]::Unescape('\u6770\u7c73')
  "jp" = [regex]::Unescape('\u6770\u5f7c')
  "juri" = [regex]::Unescape('\u86db\u4fd0')
  "ken" = [regex]::Unescape('\u80af')
  "kimberly" = [regex]::Unescape('\u91d1\u4f70\u8389')
  "lily" = [regex]::Unescape('\u8389\u8389')
  "luke" = [regex]::Unescape('\u5362\u514b')
  "mai" = [regex]::Unescape('\u821e')
  "manon" = [regex]::Unescape('\u66fc\u4fac')
  "marisa" = [regex]::Unescape('\u739b\u4e3d\u838e')
  "rashid" = [regex]::Unescape('\u62c9\u5e0c\u5fb7')
  "ryu" = [regex]::Unescape('\u9686')
  "sagat" = [regex]::Unescape('\u6c99\u52a0\u7279')
  "terry" = [regex]::Unescape('\u7279\u745e')
  "vega_mbison" = [regex]::Unescape('\u7ef4\u52a0')
  "zangief" = [regex]::Unescape('\u6851\u5409\u5c14\u592b')
}

$sectionNames = @{
  1 = "Normal Moves"
  2 = "Unique Attacks"
  3 = "Special Moves"
  4 = "Super Arts"
  5 = "Throws"
  6 = "Common Moves"
  7 = "Assisted Combos"
}

function Decode-HtmlText {
  param([string]$Text)

  if ([string]::IsNullOrEmpty($Text)) {
    return ""
  }

  $decoded = [System.Net.WebUtility]::HtmlDecode($Text)
  $decoded = [regex]::Replace($decoded, "<br\\s*/?>", "`n", "IgnoreCase")
  $decoded = [regex]::Replace($decoded, "<[^>]+>", "")
  return $decoded.Trim()
}

function Join-NoteText {
  param($Value)

  if ($null -eq $Value) {
    return ""
  }

  if ($Value -is [System.Array]) {
    $items = @()
    foreach ($item in $Value) {
      $text = Decode-HtmlText ([string]$item)
      if ($text) {
        $items += $text
      }
    }
    return ($items -join " / ")
  }

  return Decode-HtmlText ([string]$Value)
}

function Get-NextData {
  param([string]$Html)

  $match = [regex]::Match(
    $Html,
    '<script id="__NEXT_DATA__" type="application/json">(?<json>.*?)</script>',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $match.Success) {
    throw "Unable to locate __NEXT_DATA__"
  }

  return ($match.Groups["json"].Value | ConvertFrom-Json)
}

function Get-TranslationMaps {
  param([string]$Html)

  $maps = @{}
  foreach ($slug in $characterSlugs) {
    $escapedSlug = [regex]::Escape($slug)
    $objectPattern = '\{(?:"(?:\\.|[^"\\])*":"(?:\\.|[^"\\])*"(?:,"(?:\\.|[^"\\])*":"(?:\\.|[^"\\])*")*)?\}'
    $pattern = '"character/frame/' + $escapedSlug + '":(?<map>' + $objectPattern + ')'
    $match = [regex]::Match(
      $Html,
      $pattern,
      [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
    if (-not $match.Success) {
      continue
    }

    $source = $match.Groups["map"].Value | ConvertFrom-Json
    $map = @{}
    foreach ($entry in $source.PSObject.Properties) {
      $key = [string]$entry.Name
      if ($key.StartsWith("[t]")) {
        $key = $key.Substring(3)
      }
      $map[$key] = [string]$entry.Value
    }
    $maps[$slug] = $map
  }

  return $maps
}

function Get-VisibleRows {
  param([string]$Html)

  $tbodyMatch = [regex]::Match(
    $Html,
    '<tbody>(?<tbody>.*?)</tbody>',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $tbodyMatch.Success) {
    throw "Unable to locate frame table body"
  }

  $rows = @()
  $currentSection = ""
  $trMatches = [regex]::Matches(
    $tbodyMatch.Groups["tbody"].Value,
    '<tr(?<attrs>[^>]*)>(?<inner>.*?)</tr>',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  foreach ($tr in $trMatches) {
    $attrs = [string]$tr.Groups["attrs"].Value
    $inner = [string]$tr.Groups["inner"].Value

    if ($attrs -like '*frame_heading__*' -or $inner -like '*frame_heading__*') {
      $sectionMatch = [regex]::Match($inner, '<span>(?<name>[^<]+)</span>')
      if ($sectionMatch.Success) {
        $currentSection = Decode-HtmlText $sectionMatch.Groups["name"].Value
      }
      continue
    }

    $nameMatch = [regex]::Match($inner, '<span class="frame_arts__[^"]*">(?<name>.*?)</span>')
    if (-not $nameMatch.Success) {
      continue
    }

    $rows += [pscustomobject]@{
      section = $currentSection
      moveName = Decode-HtmlText $nameMatch.Groups["name"].Value
    }
  }

  return $rows
}

function Get-CharacterLabel {
  param([string]$Html)

  $match = [regex]::Match($Html, '<title>(?<title>.*?) FRAME DATA')
  if (-not $match.Success) {
    return ""
  }

  return Decode-HtmlText $match.Groups["title"].Value
}

function Get-SectionNameFromWebId {
  param([string]$WebId)

  if ([string]::IsNullOrWhiteSpace($WebId)) {
    return ""
  }

  $value = 0
  if (-not [int]::TryParse($WebId, [ref]$value)) {
    return ""
  }

  $prefix = [int][math]::Floor($value / 100)
  if ($sectionNames.ContainsKey($prefix)) {
    return $sectionNames[$prefix]
  }

  return ""
}

function Get-BlobRows {
  param([string]$PageJs)

  $matches = [regex]::Matches(
    $PageJs,
    'JSON\.parse\(''(?<json>\{\"frame\":\[.*?\]\})''\)',
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  $blobs = @()
  foreach ($match in $matches) {
    $jsonText = [regex]::Unescape($match.Groups["json"].Value)
    $blob = $jsonText | ConvertFrom-Json
      $rows = @()
      $index = 0
      foreach ($row in $blob.frame) {
      $webId = if ($null -eq $row.webId) { "" } else { ([string]$row.webId).Trim() }
      $webIdNumber = 0
      if (-not [int]::TryParse($webId, [ref]$webIdNumber)) {
        continue
      }

      $rows += [pscustomobject]@{
        blobIndex = $blobs.Count
        rawIndex = $index
        webId = [string]$webIdNumber
        skill = [string]$row.skill
        command = [string]$row.command
        commandModern = [string]$row.command_modern
        startup = [string]$row.startup_frame
        active = [string]$row.active_frame
        recovery = [string]$row.recovery_frame
        onHit = [string]$row.hit_frame
        onBlock = [string]$row.block_frame
        cancel = [string]$row.cancel
        damage = [string]$row.damage
        property = [string]$row.attribute
        notes = Join-NoteText $row.note
      }
      $index++
    }

    $blobs += ,$rows
  }

  return $blobs
}

function Get-CharacterBlobMap {
  param(
    [object[]]$Blobs,
    [hashtable]$TranslationMaps,
    [string[]]$Slugs
  )

  $result = @{}
  $usedBlobIndexes = New-Object System.Collections.Generic.HashSet[int]

  foreach ($slug in $Slugs) {
    if (-not $TranslationMaps.ContainsKey($slug)) {
      continue
    }
    $skillSet = New-Object System.Collections.Generic.HashSet[string]
    foreach ($key in $TranslationMaps[$slug].Keys) {
      [void]$skillSet.Add($key)
    }

    $bestIndex = -1
    $bestScore = -1
    for ($i = 0; $i -lt $Blobs.Count; $i++) {
      if ($usedBlobIndexes.Contains($i)) {
        continue
      }

      $score = 0
      foreach ($row in $Blobs[$i]) {
        $webIdNumber = 0
        if (-not [int]::TryParse($row.webId, [ref]$webIdNumber)) {
          continue
        }
        if ($webIdNumber -ge 500 -or [string]::IsNullOrWhiteSpace($row.skill)) {
          continue
        }
        if ($skillSet.Contains($row.skill)) {
          $score++
        }
      }

      if ($score -gt $bestScore) {
        $bestScore = $score
        $bestIndex = $i
      }
    }

    if ($bestIndex -lt 0 -or $bestScore -lt 10) {
      throw "Unable to confidently match a frame-data blob for $slug (score=$bestScore)"
    }

    [void]$usedBlobIndexes.Add($bestIndex)
    $result[$slug] = $Blobs[$bestIndex]
  }

  return $result
}

function Build-OrderedRows {
  param(
    [object[]]$Rows,
    [hashtable]$TranslationMap,
    [object[]]$VisibleRows
  )

  $normalized = @()
  foreach ($row in $Rows) {
    $moveName = $TranslationMap[$row.skill]
    if (-not $moveName) {
      $moveName = $row.skill
    }

    $normalized += [pscustomobject]@{
      rawIndex = $row.rawIndex
      webId = $row.webId
      moveName = [string]$moveName
      moveNameJa = [string]$row.skill
      command = [string]$row.command
      commandModern = [string]$row.commandModern
      startup = [string]$row.startup
      active = [string]$row.active
      recovery = [string]$row.recovery
      onHit = [string]$row.onHit
      onBlock = [string]$row.onBlock
      cancel = [string]$row.cancel
      damage = [string]$row.damage
      property = [string]$row.property
      notes = [string]$row.notes
      section = ""
      matched = $false
      htmlOrder = -1
    }
  }

  $usedIndexes = New-Object System.Collections.Generic.HashSet[int]
  $htmlOrder = 0

  foreach ($visible in $VisibleRows) {
    for ($i = 0; $i -lt $normalized.Count; $i++) {
      if ($usedIndexes.Contains($i)) {
        continue
      }
      if ($normalized[$i].moveName -ne $visible.moveName) {
        continue
      }

      [void]$usedIndexes.Add($i)
      $normalized[$i].section = $visible.section
      $normalized[$i].matched = $true
      $normalized[$i].htmlOrder = $htmlOrder
      $htmlOrder++
      break
    }
  }

  foreach ($row in $normalized) {
    if ($row.section) {
      continue
    }
    $row.section = Get-SectionNameFromWebId $row.webId
  }

  $sectionOrder = New-Object System.Collections.Generic.List[string]
  foreach ($visible in $VisibleRows) {
    if ($visible.section -and -not $sectionOrder.Contains($visible.section)) {
      [void]$sectionOrder.Add($visible.section)
    }
  }
  foreach ($section in $sectionNames.Values) {
    if ($section -and -not $sectionOrder.Contains($section)) {
      [void]$sectionOrder.Add($section)
    }
  }

  $orderedRows = New-Object System.Collections.Generic.List[object]
  foreach ($section in $sectionOrder) {
    $sectionRows = @($normalized | Where-Object { $_.section -eq $section })
    if (-not $sectionRows.Count) {
      continue
    }

    $matchedRows = @($sectionRows | Where-Object { $_.matched } | Sort-Object htmlOrder)
    $unmatchedRows = @($sectionRows | Where-Object { -not $_.matched })
    $bucket = New-Object System.Collections.Generic.List[object]

    foreach ($row in $matchedRows) {
      [void]$bucket.Add($row)
    }

    if (-not $bucket.Count) {
      foreach ($row in ($unmatchedRows | Sort-Object rawIndex)) {
        [void]$bucket.Add($row)
      }
    } else {
      foreach ($row in ($unmatchedRows | Sort-Object `
        @{ Expression = { [int]$_.webId } }, `
        @{ Expression = { $_.rawIndex } })) {
        $insertAt = $bucket.Count
        for ($i = 0; $i -lt $bucket.Count; $i++) {
          $current = $bucket[$i]
          if ([int]$current.webId -gt [int]$row.webId) {
            $insertAt = $i
            break
          }
        }
        $bucket.Insert($insertAt, $row)
      }
    }

    foreach ($row in $bucket) {
      [void]$orderedRows.Add([pscustomobject]@{
        section = $row.section
        officialId = $row.webId
        moveName = $row.moveName
        moveNameJa = $row.moveNameJa
        command = $row.command
        commandModern = $row.commandModern
        startup = $row.startup
        active = $row.active
        recovery = $row.recovery
        onHit = $row.onHit
        onBlock = $row.onBlock
        cancel = $row.cancel
        damage = $row.damage
        property = $row.property
        notes = $row.notes
      })
    }
  }

  return $orderedRows
}

Write-Host "Fetching frame page script..."
$pageJs = (Invoke-WebRequest -Uri $pageJsUrl -UseBasicParsing).Content
$blobs = Get-BlobRows -PageJs $pageJs
Write-Host ("Found {0} frame-data blobs in page script." -f $blobs.Count)

$translationMaps = @{}
$labels = @{}
$visibleRowsByCharacter = @{}

  foreach ($slug in $characterSlugs) {
  Write-Host ("Fetching HTML for {0}..." -f $slug)
  $url = "https://www.streetfighter.com/6/zh-hans/character/$slug/frame"
  $html = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content

  if (-not $translationMaps.Count) {
    $translationMaps = Get-TranslationMaps -Html $html
  }

  $labels[$slug] = if ($characterLabels.ContainsKey($slug)) { $characterLabels[$slug] } else { Get-CharacterLabel -Html $html }
  $visibleRowsByCharacter[$slug] = Get-VisibleRows -Html $html
}

$blobMap = Get-CharacterBlobMap -Blobs $blobs -TranslationMaps $translationMaps -Slugs $characterSlugs

foreach ($slug in $characterSlugs) {
  if (-not $blobMap.ContainsKey($slug)) {
    throw "Missing blob mapping for $slug"
  }

  Write-Host ("Generating override for {0}..." -f $slug)
  $rows = Build-OrderedRows `
    -Rows $blobMap[$slug] `
    -TranslationMap $translationMaps[$slug] `
    -VisibleRows $visibleRowsByCharacter[$slug]

  $payload = [ordered]@{
    character = $slug
    label = $labels[$slug]
    generatedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    rows = $rows
  }

  $outputPath = Join-Path $dashboardDir ("framedata.official.{0}.json" -f $slug)
  $payload | ConvertTo-Json -Depth 8 | Set-Content -Path $outputPath -Encoding UTF8
}

Write-Host "Done."



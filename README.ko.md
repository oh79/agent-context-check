# agent-context-check

[English](README.md) · [MIT](LICENSE)

**소스에서는 정상인데 배포물에서 빠진 스킬 참조 파일을 찾아줍니다.**

`SKILL.md`만 설치되고 `references/`나 `scripts/`가 빠지면 Agent는 필요한 문서와 명령을 사용할 수 없습니다. 배포 전에 소스 폴더와 실제 배포 폴더를 비교해, 어떤 지침의 몇 번째 줄이 빠진 파일을 참조하는지 확인하세요.

Node.js 20 이상에서 동작하며 외부 의존성·API 키가 없습니다. 검사 중 네트워크 요청이나 파일 수정이 없습니다.

## 소스와 배포물 비교

```sh
npx --yes agent-context-check@0.2.0 compare --source ./skill --artifact ./dist/skill
npx --yes agent-context-check@0.2.0 compare --source ./skill --artifact ./dist/skill --json
```

두 폴더 안의 상대 경로 구조가 같아야 합니다. tarball이 `package/`로 감싸져 있으면 압축을 푼 뒤 그 폴더를 배포물 루트로 지정하세요. 빌드·설치·압축 해제는 기존 도구로 먼저 수행합니다. 검사기는 스킬이나 명령을 실행하지 않습니다.

지침 파일 자체의 누락, 소스부터 잘못된 참조, 배포물에서만 빠진 파일, 파일·폴더 타입 불일치를 구분합니다. 파일 내용의 일치나 배포물 지침의 의미 변화는 비교하지 않습니다.

비교 모드는 Markdown 링크와 이미지·참조 링크 외에 인라인 코드의 명확한 `references/…`, `scripts/…`, `assets/…` 경로 및 `${CLAUDE_SKILL_DIR}/…` 경로를 검사합니다. 셸 예제 속 위 변수는 지침 파일이 있는 폴더를 뜻합니다. 다른 동적 변수나 glob을 실행·확장하지 않으며, 모든 Markdown·셸 문법을 이해하는 검사기는 아닙니다. 예시용 `URL` 목적지는 파일 경로로 보지 않습니다.

## GitHub Action

기존 빌드·압축 해제 단계 다음에 넣으세요.

```yaml
- uses: oh79/agent-context-check@v0.2.0
  with:
    source: ./skill
    artifact: ./dist/skill
```

별도 npm 설치나 저장소 쓰기 토큰이 필요하지 않습니다. GitHub의 Node.js 24 런타임으로 실행하며, 문제가 있으면 해당 파일과 줄에 오류를 표시하고 실패합니다. `files`에 소스 기준 파일 경로를 한 줄씩 지정할 수도 있습니다.

배포물 없이 기존 Markdown 링크만 검사하려면 `mode: check`, `source: .`를 지정합니다. 출력은 `issues-count`, `files-checked`, `references-checked`입니다.

## 기존 링크 검사

```sh
npx --yes agent-context-check@0.2.0 --root /프로젝트/경로
npx --yes agent-context-check@0.2.0 --root /프로젝트/경로 --json
```

기존 검사 모드는 코드 블록·인라인 코드 안의 경로를 건너뛰고 Markdown 링크만 검사합니다. 외부 URL, 제목 앵커, HTML, 정의 없는 참조형 링크는 확인하지 않습니다. 검사 대상은 `AGENTS.md`, `CLAUDE.md`, `SKILL.md`이며 파일을 직접 지정할 수도 있습니다.

자동 검색은 심볼릭 링크와 `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, `vendor`를 건너뜁니다. `dist` 자체를 배포물 루트로 지정하는 것은 가능합니다. 양쪽 실제 루트를 벗어나는 경로·심볼릭 링크를 보고하지만 파일 시스템 격리 도구는 아니므로 신뢰할 수 있는 파일 트리에서 사용하세요.

`npx`는 필요할 때 패키지를 내려받습니다. 검사기 자체는 인터넷에 접속하지 않습니다. 저장소를 받아 `node bin/agent-context-check.js`로 실행해도 됩니다.

## 종료 코드와 개발

종료 코드 `0`은 지원하는 참조에서 문제를 찾지 못함, `1`은 문제 발견 또는 지침 파일 없음, `2`는 잘못된 명령이나 루트입니다. 문제 0개가 모든 지침·참조의 유효성을 보장하지는 않습니다.

```sh
npm test
npm run check
npm pack --dry-run
```

JavaScript API·전체 설정은 [영문 설명](README.md), 검증 방식과 한계는 [실제 패키지 검증 보고서](docs/validation-0.2.0.md), 기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. 실제 패키지 검증과 외부 사용자의 채택은 별개입니다.

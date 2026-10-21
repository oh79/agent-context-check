# agent-context-check

[English](README.md) · [MIT](LICENSE)

코딩 Agent가 따라가기 전에 `AGENTS.md`, `CLAUDE.md`, `SKILL.md`의 **깨진 로컬 Markdown 링크**를 찾아줍니다.

빌드 문서나 ADR을 옮기고 지웠는데 Agent 지침의 링크를 그대로 두는 일이 있습니다. 이 도구는 링크가 실제로 존재하는지, 프로젝트 바깥으로 벗어나지 않는지 확인합니다.

외부 의존성 없이 **Node.js 20 이상**에서 실행합니다. 검사 중 네트워크 요청이나 파일 수정이 없고 API 키도 필요하지 않습니다.

## 실행

```sh
git clone https://github.com/oh79/agent-context-check.git
cd agent-context-check
node bin/agent-context-check.js --root /검사할/프로젝트/경로
```

GitHub 태그를 지정해 설치 없이 실행할 수도 있습니다.

```sh
npm exec --yes --package=github:oh79/agent-context-check#v0.1.0 -- agent-context-check --root .
```

위 npm 명령은 패키지를 다운로드합니다. 검사기 자체는 인터넷에 접속하지 않습니다. 배포처는 GitHub이며 npm 레지스트리에는 게시하지 않았습니다.

`[빌드 문서](docs/old-build.md)`가 가리키는 파일이 없으면 지침 파일명, 줄 번호, 대상, 원인을 표시합니다.

파일을 직접 지정하거나 JSON으로 결과를 받을 수 있습니다.

```sh
node bin/agent-context-check.js --root /프로젝트 README.md docs/setup.md
node bin/agent-context-check.js --root /프로젝트 --json
```

## 검사 범위

- 하위 폴더를 포함해 `AGENTS.md`, `CLAUDE.md`, `SKILL.md`를 자동으로 찾습니다.
- 일반 링크·이미지·참조형 Markdown 링크를 검사합니다.
- 상대 경로는 지침 파일 기준, `/docs/guide.md`는 프로젝트 루트 기준입니다.
- Unicode 파일명, URL 인코딩, 꺾쇠 괄호로 감싼 공백 포함 경로를 처리합니다.
- 없는 파일, 잘못된 경로, 읽을 수 없는 입력, 심볼릭 링크를 통한 프로젝트 외부 참조를 보고합니다.

코드 블록·인라인 코드·HTML 주석과 외부 URL은 건너뜁니다. `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, `vendor`와 자동 검색 중 만나는 심볼릭 링크 파일·폴더도 건너뜁니다. 직접 지정한 입력은 실제 경로가 루트 안에 있는지 확인합니다.

파일과 폴더의 존재만 확인하며 `#제목`·`?쿼리`의 유효성은 확인하지 않습니다. 백틱으로 감싼 경로나 일반 문장 속 경로도 검사하지 않습니다. 검사하려는 참조는 `[문서](docs/guide.md)`로 작성하세요. 정의가 없는 참조형 링크, HTML 링크, MDX, 모든 CommonMark 문법을 지원하지 않습니다.

Agent가 문서를 실제로 읽거나 지침을 따르는지는 검사하지 않습니다. 신뢰할 수 있는 저장소에서 사용하세요. 파일 시스템 보안 격리 도구는 아닙니다.

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| `0` | 검사한 파일에 문제 없음 |
| `1` | 문제 발견 또는 자동 검색 결과 없음 |
| `2` | 잘못된 명령이나 사용할 수 없는 루트 |

`--json` 결과는 `{ filesChecked, linksChecked, issues }`이며 문제별로 `file`, `line`, `target`, `code`, `message`를 제공합니다.

GitHub Actions 설정과 JavaScript API는 [영문 설명](README.md)을 참고하세요. 기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md), 예시는 [examples](examples/README.md)에 있습니다.

## 개발

```sh
npm test
npm run check
npm pack --dry-run
```

별도 설치나 빌드 과정이 필요하지 않습니다. [MIT 라이선스](LICENSE)로 공개합니다.

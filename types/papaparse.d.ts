declare module "papaparse" {
  export interface ParseError {
    type?: string;
    code?: string;
    message: string;
    row?: number;
  }

  export interface ParseMeta {
    delimiter?: string;
    linebreak?: string;
    aborted?: boolean;
    truncated?: boolean;
    cursor?: number;
    fields?: string[];
  }

  export interface ParseResult<T> {
    data: T[];
    errors: ParseError[];
    meta: ParseMeta;
  }

  export interface Parser {
    abort: () => void;
    pause: () => void;
    resume: () => void;
  }

  export interface ParseConfig<T> {
    delimiter?: string;
    newline?: string;
    quoteChar?: string;
    escapeChar?: string;
    header?: boolean;
    dynamicTyping?: boolean;
    preview?: number;
    encoding?: string;
    worker?: boolean;
    comments?: string | boolean;
    step?: (results: ParseResult<T>, parser: Parser) => void;
    complete?: (results: ParseResult<T>, file?: File) => void;
    error?: (error: ParseError, file?: File) => void;
    download?: boolean;
    skipEmptyLines?: boolean | "greedy";
    chunk?: (results: ParseResult<T>, parser: Parser) => void;
    fastMode?: boolean;
    beforeFirstChunk?: (chunk: string) => string | void;
  }

  export interface UnparseConfig {
    delimiter?: string;
    newline?: string;
    quotes?: boolean | boolean[];
    quoteChar?: string;
    escapeChar?: string;
    header?: boolean;
    columns?: string[];
    skipEmptyLines?: boolean | "greedy";
  }

  export function parse<T>(input: string | File, config?: ParseConfig<T>): ParseResult<T>;
  export function unparse<T>(
    data: T[] | { fields: string[]; data: T[] },
    config?: UnparseConfig
  ): string;

  const Papa: {
    parse: typeof parse;
    unparse: typeof unparse;
  };

  export default Papa;
}

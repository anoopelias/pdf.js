/* globals expect, it, describe, PDFNetworkStream, beforeAll */

'use strict';

describe('network', function() {
  var pdf1 = new URL('../pdfs/tracemonkey.pdf', window.location).href;
  var pdf1Length = 1016315;
  var pdf2 = new URL('../pdfs/pdf.pdf', window.location).href;
  var pdf2Length = 32472771;

  it('read without stream and range', function(done) {
    var stream = new PDFNetworkStream({
      source: {
        url: pdf1,
        rangeChunkSize: 65536,
        disableStream: true,
      },
      disableRange: true
    });

    var fullReader = stream.getFullReader();

    var isStreamingSupported, isRangeSupported;
    var promise = fullReader.headersReady.then(function () {
      isStreamingSupported = fullReader.isStreamingSupported;
      isRangeSupported = fullReader.isRangeSupported;
    });

    var len = 0, count = 0;
    var read = function () {
      return fullReader.read().then(function (result) {
        if (result.done) {
          return;
        }
        count++;
        len += result.value.byteLength;
        return read();
      });
    };

    var readPromise = read();

    readPromise.then(function (page) {
      expect(len).toEqual(pdf1Length);
      expect(count).toEqual(1);
      expect(isStreamingSupported).toEqual(false);
      expect(isRangeSupported).toEqual(false);
      done();
    }).catch(function (reason) {
      done.fail(reason);
    });
  });

  it('read with streaming', function(done) {
    var userAgent = window.navigator.userAgent;
    // The test is valid for FF only: the XHR has support of the
    // 'moz-chunked-array' response type.
    // TODO enable for other browsers, e.g. when fetch/streams API is supported.
    var m = /Mozilla\/5.0.*?rv:(\d+).*? Gecko/.exec(userAgent);
    if (!m || m[1] < 9) {
      expect(true).toEqual(true);
      done();
      return;
    }

    var stream = new PDFNetworkStream({
      source: {
        url: pdf2,
        rangeChunkSize: 65536,
        disableStream: false,
      },
      disableRange: false
    });

    var fullReader = stream.getFullReader();

    var isStreamingSupported, isRangeSupported;
    var promise = fullReader.headersReady.then(function () {
      isStreamingSupported = fullReader.isStreamingSupported;
      isRangeSupported = fullReader.isRangeSupported;
    });

    var len = 0, count = 0;
    var read = function () {
      return fullReader.read().then(function (result) {
        if (result.done) {
          return;
        }
        count++;
        len += result.value.byteLength;
        return read();
      });
    };

    var readPromise = read();

    readPromise.then(function () {
      expect(len).toEqual(pdf2Length);
      expect(count).toBeGreaterThan(1);
      expect(isStreamingSupported).toEqual(true);
      done();
    }).catch(function (reason) {
      done.fail(reason);
    });
  });

  it('read custom ranges', function (done) {
    // We don't test on browsers that don't support range request, so
    // requiring this test to pass.
    var rangeSize = 32768;
    var stream = new PDFNetworkStream({
      source: {
        url: pdf1,
        length: pdf1Length,
        rangeChunkSize: rangeSize,
        disableStream: true,
      },
      disableRange: false
    });

    var fullReader = stream.getFullReader();

    var isStreamingSupported, isRangeSupported, fullReaderCancelled;
    var promise = fullReader.headersReady.then(function () {
      isStreamingSupported = fullReader.isStreamingSupported;
      isRangeSupported = fullReader.isRangeSupported;
      // we shall be able to close the full reader without issues
      fullReader.cancel('Don\'t need full reader');
      fullReaderCancelled = true;
    });

    // Skipping fullReader results, requesting something from the PDF end.
    var tailSize = (pdf1Length % rangeSize) || rangeSize;

    var range1Reader = stream.getRangeReader(pdf1Length - tailSize - rangeSize,
                                             pdf1Length - tailSize);
    var range2Reader = stream.getRangeReader(pdf1Length - tailSize, pdf1Length);

    var result1 = {value: 0}, result2 = {value: 0};
    var read = function (reader, lenResult) {
      return reader.read().then(function (result) {
        if (result.done) {
          return;
        }
        lenResult.value += result.value.byteLength;
        return read(reader, lenResult);
      });
    };

    var readPromises = Promise.all([read(range1Reader, result1),
                                    read(range2Reader, result2),
                                    promise]);

    readPromises.then(function () {
      expect(result1.value).toEqual(rangeSize);
      expect(result2.value).toEqual(tailSize);
      expect(isRangeSupported).toEqual(true);
      expect(fullReaderCancelled).toEqual(true);
      done();
    }).catch(function (reason) {
      done.fail(reason);
    });
  });

  describe('contentDisposition', function() {
    var getFilename;
    beforeAll(function() {
      var stream = new PDFNetworkStream({
        source: {
          url: pdf1,
          rangeChunkSize: 65536,
          disableStream: true,
        },
        disableRange: true
      });

      var fullReader = stream.getFullReader();
      getFilename = fullReader._getFilename;
    });

    it('should not get filename from nothing', function() {
      expect(getFilename()).not.toBeDefined();
      expect(getFilename(null)).not.toBeDefined();
    });

    it('should not get filename if it is not present', function() {
      expect(getFilename('inline')).not.toBeDefined();
      expect(getFilename('attachment')).not.toBeDefined();

      expect(getFilename('inline;')).not.toBeDefined();
      expect(getFilename('attachment; ')).not.toBeDefined();

      expect(getFilename('inline; bar=baz')).not.toBeDefined();
    });

    it('should get filename if available', function() {
      expect(getFilename('inline;filename=foo.pdf')).toEqual('foo.pdf');
      expect(getFilename(' inline ; filename = foo.pdf ')).toEqual('foo.pdf');
      expect(getFilename('  inline  ;  filename  =  foo.pdf  '))
        .toEqual('foo.pdf');
    });

    it('should get filename case insensitive', function() {
      expect(getFilename('inline; FILENAME=foo.pdf')).toEqual('foo.pdf');
      expect(getFilename('inline; Filename=foo.pdf')).toEqual('foo.pdf');
      expect(getFilename('inline; FiLeNaMe=foo.pdf')).toEqual('foo.pdf');

      expect(getFilename('INLINE;filename=foo.pdf')).toEqual('foo.pdf');
      expect(getFilename('Attachment;filename=foo.pdf')).toEqual('foo.pdf');
    });

    it('should get filename when tab is present in the string', function() {
      expect(getFilename('\tinline\t;\tfilename\t=\tfoo.pdf\t'))
        .toEqual('foo.pdf');
      expect(getFilename('\t\tinline\t\t;\t\tfilename\t\t=\t\tfoo.pdf\t\t'))
        .toEqual('foo.pdf');
      expect(getFilename('\t inline\t ;\t filename\t =\t foo.pdf\t '))
        .toEqual('foo.pdf');
    });

    it('should get filename when newline is present in the string', function() {
      expect(getFilename(
            '\r\n inline\r\n ;\r\n filename\r\n =\r\n foo.pdf\r\n '))
        .toEqual('foo.pdf');
      expect(getFilename('inline\r\n\t;filename=foo.pdf'))
        .toEqual('foo.pdf');
      expect(getFilename('inline\r\n \r\n ;filename=foo.pdf'))
        .toEqual('foo.pdf');
    });

    it('should not get filename if value is not present', function() {
      expect(getFilename('inline; filename=')).not.toBeDefined();
    });

    it('should not allow filename when type is not present', function() {
      expect(getFilename('filename=foo.pdf')).not.toBeDefined();
      expect(getFilename(';filename=foo.pdf')).not.toBeDefined();
      expect(getFilename(' ;filename=foo.pdf')).not.toBeDefined();
    });

    it('should not allow separators in filename', function() {
      expect(getFilename('inline;filename=foo<>.pdf')).not.toBeDefined();
      expect(getFilename('inline;filename=foo@bar.pdf')).not.toBeDefined();
    });

    it('should not allow control characters in filename', function() {
      expect(getFilename('inline;filename=foo\r\n.pdf')).not.toBeDefined();
      expect(getFilename('inline;filename=foo\b.pdf')).not.toBeDefined();
    });

    it('should get filename when other params are available', function() {
      expect(getFilename('inline;filename=foo.pdf;bar=baz')).toEqual('foo.pdf');
      expect(getFilename('inline;bar=baz;filename=foo.pdf')).toEqual('foo.pdf');
    });

    it('should not allow space in file name', function() {
      expect(getFilename('inline;filename=foo bar.pdf')).not.toBeDefined();
      expect(getFilename('inline;filename=foo\tbar.pdf')).not.toBeDefined();
    });

    it('should allow space in file name when quoted', function() {
      expect(getFilename('inline;filename="foo bar.pdf"'))
        .toEqual('foo bar.pdf');
      expect(getFilename('inline;filename = " foo.pdf" '))
        .toEqual(' foo.pdf');
    });

    it('should get filename when the value is quoted', function() {
      expect(getFilename('inline;filename="foo.pdf"')).toEqual('foo.pdf');
      expect(getFilename('inline;filename = "foo.pdf"')).toEqual('foo.pdf');
    });

    it('should not get filename when quotes is not closed', function() {
      expect(getFilename('inline;filename="foo bar.pdf'))
        .not.toBeDefined();
      expect(getFilename('inline;filename="foo bar.pdf\\"'))
        .not.toBeDefined();
    });

    it('should not allow quotes in file name', function() {
      expect(getFilename('inline;filename="foo "bar" baz.pdf"'))
        .not.toBeDefined();
    });

    it('should get filename when quotes are escaped', function() {
      expect(getFilename('inline;filename="foo \\"bar\\" baz.pdf"'))
        .toEqual('foo "bar" baz.pdf');
    });

    it('should get filename when a control character is escaped', function() {
      expect(getFilename('inline;filename="foo\\\n.pdf"'))
        .toEqual('foo\n.pdf');
    });

    it('should get filename when a normal character is escaped', function() {
      expect(getFilename('inline;filename="foo.p\\df"'))
        .toEqual('foo.pdf');
    });

    it('should allow separators when filename is quoted', function() {
      expect(getFilename('inline;filename="foo<>.pdf"')).toEqual('foo<>.pdf');
      expect(getFilename('inline;filename="foo@bar.pdf"'))
        .toEqual('foo@bar.pdf');
    });

    it('should not allow control characters even when filename is quoted',
        function() {
      expect(getFilename('inline;filename="foo\r\n.pdf"')).not.toBeDefined();
      expect(getFilename('inline;filename="foo\bbar.pdf"')).not.toBeDefined();
    });

    it('should not allow filename when other params are invalid', function() {
      expect(getFilename('inline;filename=foo.pdf;bar=baz@.pdf'))
          .not.toBeDefined();
      expect(getFilename('inline;;filename=foo.pdf')).not.toBeDefined();
    });

    it('should not allow a trailing semicolon', function() {
      expect(getFilename('inline;filename=foo.pdf;')).not.toBeDefined();
      expect(getFilename('inline;filename=foo.pdf; ')).not.toBeDefined();
    });

    it('should ignore attributes present in the filename', function() {
      expect(getFilename(
            'inline;bar="bar;filename=baz.pdf;qux";filename=foo.pdf'))
        .toEqual('foo.pdf');
      expect(getFilename(
            'inline;filename=foo.pdf;bar="bar;filename=baz.pdf"'))
        .toEqual('foo.pdf');
    });

    it('should not allow filename to be specified twice', function() {
      expect(getFilename('inline;filename=foo.pdf;filename=bar.pdf'))
        .not.toBeDefined();
    });

  });
});

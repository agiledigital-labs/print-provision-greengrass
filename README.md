# PrintOS Something todo name

todo content

For now, see <https://jira.agiledigital.com.au/browse/QFXFB-888>.

todo put the drawio diagram in here

todo is there anything we should copy from the print-provision repo's README?

## Testing

For testing, you can configure the ReceiptPrinter component to print to PDF. However, the PDF will
always be blank, so you still need a real receipt printer to test the output.

 1. Install the print-to-PDF driver on your test device: `sudo apt install cups cups-bsd
    printer-driver-cups-pdf`
 1. In `/etc/cups/cups-pdf.conf` on your device, comment out the line `Out ${HOME}/PDF`. That
    configures the driver to write the PDFs to `/var/spool/cups-pdf/ggc_user` (`ggc_user` is the
    user the component runs as), which avoids permissions issues.
 1. Restart CUPS: `sudo systemctl restart cups`
 1. In <recipes/io.datapos.ReceiptPrinter-1.0.0.yaml>, change `printer: EPSON_TM-T82III` to
    `printer: PDF` and redeploy.

### Submitting a Test Job

In this example, `https://3qpbp0efwe.execute-api.ap-southeast-2.amazonaws.com/dev/submit` is the
`/submit` endpoint of your
[printos-serverless-service](https://github.com/DataPOS-Labs/printos-serverless-service) deployment,
`blueberry` is the password in its DynamoDB and `MyGreengrassCore` is the AWS IoT Thing Name of your
test device (i.e. your Raspberry Pi).

```
curl https://3qpbp0efwe.execute-api.ap-southeast-2.amazonaws.com/dev/submit --data 'destination=MyG\
reengrassCore&password=blueberry&data=%7B%22mode%22%3A%22tagged%22%2C%22comments%22%3A%22%3Ccenter%\
3E+Powered+by+DataPOS+%3C%2Fcenter%3E+%3Ccenter%3E+Powered+by+DataPOS+%3C%2Fcenter%3E+%3Ccenter%3E+\
%3Ch3%3ETime+Ordered%3A%3C%2Fh3%3E+%3C%2Fcenter%3E+%3Ccenter%3E+%3Ch3%3E+2%2F05%2F21+2%3A23+PM+%3C%\
2Fh3%3E+%3C%2Fcenter%3E+%3Cleft%3EService+Mode%3A+TakeAway%3C%2Fleft%3E+++++%3Cleft%3E+%3Ch3%3E1+Br\
azilian+Rooster%7E%3C%2Fh3%3E+%3C%2Fleft%3E+++++%3Cleft%3E+%3Ch3%3E2+Japanese+Rooster%7E%3C%2Fh3%3E\
+%3C%2Fleft%3E+++++%3Cleft%3E+%3Ch3%3E1+Little+Rooster%7E%3C%2Fh3%3E+%3C%2Fleft%3E+++++%3Cleft%3E+%\
3Ch3%3E1+Manly+Rooster%7E%3C%2Fh3%3E+%3C%2Fleft%3E++++++%3Ccenter%3E%3Ch3%3E%2B+Pineapple%3C%2Fh3%3\
E%3C%2Fcenter%3E++++++%3Ccenter%3E%3Ch3%3E%2B+Bacon%3C%2Fh3%3E%3C%2Fcenter%3E+++++++++%3Cleft%3E+%3\
Ch3%3E3+Hot+Chips%3C%2Fh3%3E+%3C%2Fleft%3E++++++%3Ccenter%3E%3Ch3%3EChicken+Salt%3C%2Fh3%3E%3C%2Fce\
nter%3E+++++%3Cleft%3E+%3Ch3%3E2+Hot+Chips%3C%2Fh3%3E+%3C%2Fleft%3E++++++%3Ccenter%3E%3Ch3%3ERegula\
r+Salt%3C%2Fh3%3E%3C%2Fcenter%3E++++%3Ccenter%3E+%3Ch4%3EOrder+and+Collect%3C%2Fh4%3E+%3C%2Fcenter%\
3E+%3Ccenter%3E+%3Ch5%3EOrder+NO.+Y14%3C%2Fh5%3E+%3C%2Fcenter%3E++++%3Cleft%3EPhone%3A+%2B614001210\
94%3C%2Fleft%3E+++++%3Cleft%3EName%3A+Sharon+Newman%3C%2Fleft%3E++++%3Ccenter%3E+Powered+by+DataPOS\
+%3C%2Fcenter%3E+%22%7D'
```
